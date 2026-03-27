import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MercadoPagoConfig, Preference, PreApproval } from "mercadopago";
import admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";

dotenv.config();

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

const preferenceClient = new Preference(client);
const preApprovalClient = new PreApproval(client);

const FRONTEND_URL = process.env.FRONTEND_URL || "https://skanoalerta-maker.github.io/nebula";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";

app.get("/", (req, res) => {
  res.json({ ok: true, service: "Nebula payments backend" });
});

/**
 * Crear pago individual por novela
 * body esperado:
 * {
 *   uid: "abc123",
 *   novelId: "codigo-nebula",
 *   title: "Código Nébula",
 *   price: 1500
 * }
 */
app.post("/create-novel-payment", async (req, res) => {
  try {
    const { uid, novelId, title, price } = req.body || {};

    if (!uid || !novelId || !title || !price) {
      return res.status(400).json({
        ok: false,
        error: "Faltan datos obligatorios: uid, novelId, title, price"
      });
    }

    const externalReference = `novel_${uid}_${novelId}_${Date.now()}`;

    const preference = await preferenceClient.create({
      body: {
        items: [
          {
            title: `Nébula - ${title}`,
            quantity: 1,
            unit_price: Number(price),
            currency_id: "CLP"
          }
        ],
        external_reference: externalReference,
        metadata: {
          uid,
          novelId,
          type: "single_novel"
        },
        back_urls: {
          success: `${FRONTEND_URL}/success.html`,
          failure: `${FRONTEND_URL}/failure.html`,
          pending: `${FRONTEND_URL}/pending.html`
        },
        auto_return: "approved",
        notification_url: WEBHOOK_URL || undefined
      }
    });

    await db.collection("payments").doc(externalReference).set({
      uid,
      novelId,
      title,
      price: Number(price),
      type: "single_novel",
      status: "created",
      externalReference,
      preferenceId: preference.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.json({
      ok: true,
      init_point: preference.init_point,
      preference_id: preference.id,
      external_reference: externalReference
    });
  } catch (error) {
    console.error("Error create-novel-payment:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "No se pudo crear el pago"
    });
  }
});

/**
 * Crear suscripción premium mensual
 * body esperado:
 * {
 *   uid: "abc123",
 *   email: "correo@ejemplo.com"
 * }
 */
app.post("/create-premium-subscription", async (req, res) => {
  try {
    const { uid, email } = req.body || {};

    if (!uid || !email) {
      return res.status(400).json({
        ok: false,
        error: "Faltan datos obligatorios: uid, email"
      });
    }

    const externalReference = `premium_${uid}_${Date.now()}`;

    const preapproval = await preApprovalClient.create({
      body: {
        reason: "Nébula Premium Mensual",
        external_reference: externalReference,
        payer_email: email,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: 6990,
          currency_id: "CLP"
        },
        back_url: `${FRONTEND_URL}/success.html`,
        status: "pending",
        notification_url: WEBHOOK_URL || undefined
      }
    });

    await db.collection("subscriptions").doc(externalReference).set({
      uid,
      email,
      type: "premium_monthly",
      status: "created",
      externalReference,
      preapprovalId: preapproval.id,
      initPoint: preapproval.init_point || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.json({
      ok: true,
      init_point: preapproval.init_point,
      preapproval_id: preapproval.id,
      external_reference: externalReference
    });
  } catch (error) {
    console.error("Error create-premium-subscription:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "No se pudo crear la suscripción"
    });
  }
});

export const api = onRequest(
  {
    cors: true
  },
  app
);
