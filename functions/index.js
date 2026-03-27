import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MercadoPagoConfig } from "mercadopago";
import admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";

dotenv.config();

if (!admin.apps.length) {
  admin.initializeApp();
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

app.get("/", (req, res) => {
  res.json({ ok: true });
});

export const api = onRequest(app);
