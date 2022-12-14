import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import joi from "joi";
import dayjs from "dayjs";
import { stripHtml } from "string-strip-html";

const participantSchema = joi.object({
  name: joi.string().required().min(3).max(20),
});

const messageSchema = joi.object({
  to: joi.string().required().min(3).max(20),
  text: joi.string().required(),
  type: joi.string().valid("message", "private_message").required(),
});

const app = express();
dotenv.config();
app.use(cors());
app.use(express.json());

const mongoClient = new MongoClient(process.env.MONGO_URI);

try {
  await mongoClient.connect();
} catch (err) {
  console.log(err);
}

const db = mongoClient.db("batepapouol");
const participantCollection = db.collection("participants");
const messageCollection = db.collection("messages");

app.post("/participants", async (req, res) => {
  const participant = req.body;
  const name = stripHtml(participant.name).result.trim();

  const { error } = participantSchema.validate(participant, {
    abortEarly: false,
  });

  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return res.status(422).send(errors);
  }

  try {
    const userExists = await participantCollection.findOne({
      name: { $regex: name, $options: "i" },
    });
    if (userExists) {
      return res.status(409).send({ message: "Esse nome já existe" });
    }

    await participantCollection.insertOne({
      name: name,
      lastStatus: Date.now(),
    });
    await messageCollection.insertOne({
      from: name,
      to: "Todos",
      text: "entra na sala...",
      type: "status",
      time: dayjs().format("HH:mm:ss"),
    });
    return res.sendStatus(201);
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

app.get("/participants", async (req, res) => {
  try {
    const participants = await participantCollection.find().toArray();
    res.status(200).send(participants);
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

app.post("/messages", async (req, res) => {
  const message = req.body;
  const from = req.headers.user;

  const { error } = messageSchema.validate(message, { abortEarly: false });

  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return res.status(422).send(errors);
  }

  try {
    const userExists = await participantCollection.findOne({ name: from });

    if (!userExists) {
      return res.status(422).send({ message: "Participante não encontrado" });
    }

    await messageCollection.insertOne({
      from: stripHtml(from).result.trim(),
      to: stripHtml(message.to).result.trim(),
      text: stripHtml(message.text).result.trim(),
      type: stripHtml(message.type).result.trim(),
      time: dayjs().format("HH:mm:ss"),
    });
    return res.sendStatus(201);
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

app.get("/messages", async (req, res) => {
  try {
    const user = req.headers.user;
    const userExists = await participantCollection.findOne({ name: user });

    if (!userExists) {
      return res.status(422).send({ message: "Participante não encontrado" });
    }

    const messages = await messageCollection
      .find({
        $or: [
          { from: user },
          { to: user },
          { type: "message" },
          { type: "status" },
        ],
      })
      .toArray();
    const orderedMessages = messages.reverse();
    const limit = parseInt(req.query.limit);

    if (!limit || limit <= 0) {
      return res.status(200).send(messages);
    } else {
      return res.status(200).send(orderedMessages.slice(0, limit).reverse());
    }
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

app.post("/status", async (req, res) => {
  try {
    const user = req.headers.user;

    const userExists = await participantCollection.findOne({ name: user });
    if (!userExists) {
      return res.sendStatus(404);
    }

    await participantCollection.updateOne(
      { name: user },
      { $set: { lastStatus: Date.now() } }
    );
    return res.sendStatus(200);
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

app.delete("/messages/:id", async (req, res) => {
  const user = req.headers.user;
  const id = req.params.id;

  try {
    const messageExists = await messageCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!messageExists) {
      return res.sendStatus(404);
    } else if (messageExists.from !== user) {
      return res.sendStatus(401);
    }

    await messageCollection.deleteOne({ _id: new ObjectId(id) });
    return res.send("Mensagem apagada com sucesso");
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

app.put("/messages/:id", async (req, res) => {
  const message = req.body;
  const from = req.headers.user;
  const id = req.params.id;

  const { error } = messageSchema.validate(message, { abortEarly: false });

  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return res.status(422).send(errors);
  }

  try {
    const userExists = await participantCollection.findOne({ name: from });

    if (!userExists) {
      return res.status(422).send({ message: "Participante não encontrado" });
    }

    const messageExists = await messageCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!messageExists) {
      return res.sendStatus(404);
    } else if (messageExists.from !== from) {
      return res.sendStatus(401);
    }

    await messageCollection.updateOne(
      { _id: messageExists._id },
      {
        $set: {
          from: stripHtml(from).result.trim(),
          to: stripHtml(message.to).result.trim(),
          text: stripHtml(message.text).result.trim(),
          type: stripHtml(message.type).result.trim(),
          time: dayjs().format("HH:mm:ss"),
        },
      }
    );
    return res.sendStatus(200);
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

async function inactiveUser() {
  const toMilliseconds = 10 * 1000;
  const treshold = Date.now() - toMilliseconds;

  try {
    const inactiveUsers = await participantCollection
      .find({ lastStatus: { $lt: treshold } })
      .toArray();
    if (inactiveUsers.length !== 0) {
      const names = inactiveUsers.map((user) => user.name);
      await participantCollection.deleteMany({ name: { $in: names } });
      const leaveMessages = names.map((user) => ({
        from: user,
        to: "Todos",
        text: "sai da sala...",
        type: "status",
        time: dayjs().format("HH:mm:ss"),
      }));
      await messageCollection.insertMany(leaveMessages);
    }
  } catch (err) {
    console.log(err);
  }
}

setInterval(inactiveUser, 15000);

app.listen(5000);
