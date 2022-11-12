import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import joi from "joi";
import dayjs from "dayjs";

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

  const { error } = participantSchema.validate(participant, {
    abortEarly: false,
  });

  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return res.status(422).send(errors);
  }

  try {
    const userExists = await participantCollection.findOne({
      name: { $regex: participant.name, $options: "i" },
    });
    if (userExists) {
      return res.status(409).send({ message: "Esse nome já existe" });
    }

    await participantCollection.insertOne({
      ...participant,
      lastStatus: Date.now(),
    });
    await messageCollection.insertOne({
      from: participant.name,
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
      from: from,
      ...message,
      time: dayjs().format("HH:mm:ss"),
    });
    return res.sendStatus(201);
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

app.listen(5000);
