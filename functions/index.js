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

const FRONTEND_URL =
  process.env.FRONTEND_URL || "https://skanoalerta-maker.github.io/nebula";

const WEBHOOK_URL =
  process.env.WEBHOOK_URL ||
  "https://us-central1-nebula-app.cloudfunctions.net/api/webhook";

/**
 * PRECIOS
 */
const NOVEL_PRICE = 1500;
const PREMIUM_PRICE = 4990;

/**
 * CREAR PAGO NOVELA
 */
app.post("/create-novel-payment", async (req, res) => {
  try {
    const { uid, novelId, title } = req.body;

    if (!uid || !novelId || !title) {
      return res.status(400).json({ ok: false });
    }

    const externalReference = `novel_${uid}_${novelId}_${Date.now()}`;

    const preference = await preferenceClient.create({
      body: {
        items: [
          {
            title: `Nébula - ${title}`,
            quantity: 1,
            unit_price: NOVEL_PRICE,
            currency_id: "CLP"
          }
        ],
        external_reference: externalReference,
        metadata: {
          uid,
          novelId,
          type: "novel"
        },
        back_urls: {
          success: `${FRONTEND_URL}/success.html`,
          failure: `${FRONTEND_URL}/failure.html`,
          pending: `${FRONTEND_URL}/pending.html`
        },
        auto_return: "approved",
        notification_url: WEBHOOK_URL
      }
    });

    await db.collection("payments").doc(externalReference).set({
      uid,
      novelId,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      ok: true,
      init_point: preference.init_point
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

/**
 * CREAR PREMIUM
 */
app.post("/create-premium-subscription", async (req, res) => {
  try {
    const { uid, email } = req.body;

    const externalReference = `premium_${uid}_${Date.now()}`;

    const preapproval = await preApprovalClient.create({
      body: {
        reason: "Nébula Premium",
        external_reference: externalReference,
        payer_email: email,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: PREMIUM_PRICE,
          currency_id: "CLP"
        },
        back_url: `${FRONTEND_URL}/success.html`,
        notification_url: WEBHOOK_URL
      }
    });

    await db.collection("subscriptions").doc(externalReference).set({
      uid,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      ok: true,
      init_point: preapproval.init_point
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

/**
 * 🔥 WEBHOOK (LO IMPORTANTE)
 */
app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;

    console.log("Webhook recibido:", data);

    const externalReference =
      data?.data?.id || data?.external_reference;

    if (!externalReference) {
      return res.sendStatus(200);
    }

    // 🔹 NOVELA
    if (externalReference.startsWith("novel_")) {
      const paymentRef = db.collection("payments").doc(externalReference);
      const paymentDoc = await paymentRef.get();

      if (paymentDoc.exists) {
        const { uid, novelId } = paymentDoc.data();

        // marcar pagado
        await paymentRef.update({
          status: "approved"
        });

        // 🔥 AGREGAR NOVELA AL USUARIO
        await db.collection("users").doc(uid).update({
          purchasedNovels: admin.firestore.FieldValue.arrayUnion(novelId)
        });
      }
    }

    // 🔹 PREMIUM
    if (externalReference.startsWith("premium_")) {
      const subRef = db.collection("subscriptions").doc(externalReference);
      const subDoc = await subRef.get();

      if (subDoc.exists) {
        const { uid } = subDoc.data();

        await subRef.update({
          status: "active"
        });

        // 🔥 ACTIVAR PREMIUM
        await db.collection("users").doc(uid).update({
          plan: "premium",
          subscription: "premium"
        });
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e);
    res.sendStatus(200);
  }
});

export const api = onRequest({ cors: true }, app);
