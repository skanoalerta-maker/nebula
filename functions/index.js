import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { MercadoPagoConfig, Preference } from "mercadopago";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const FRONTEND_URL = (process.env.FRONTEND_URL || "https://skanoalerta-maker.github.io/nebula").replace(/\/$/, "");
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";

if (!MP_ACCESS_TOKEN) {
  console.error("Falta MP_ACCESS_TOKEN en variables de entorno.");
}

const mpClient = new MercadoPagoConfig({
  accessToken: MP_ACCESS_TOKEN,
});

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Nebula functions working",
  });
});

/**
 * Crea una preferencia de pago en Mercado Pago
 * Espera un body como:
 * {
 *   "title": "Nébula Premium Mensual",
 *   "price": 6990,
 *   "quantity": 1,
 *   "type": "premium_monthly",
 *   "novelId": "codigo-nebula",
 *   "userId": "abc123",
 *   "email": "cliente@email.com"
 * }
 */
app.post("/create-preference", async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "Mercado Pago no está configurado en el backend.",
      });
    }

    const {
      title,
      price,
      quantity = 1,
      type = "single_purchase",
      novelId = null,
      userId = null,
      email = null,
    } = req.body || {};

    if (!title || !price) {
      return res.status(400).json({
        ok: false,
        error: "Faltan datos obligatorios: title y price.",
      });
    }

    const numericPrice = Number(price);
    const numericQuantity = Number(quantity);

    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return res.status(400).json({
        ok: false,
        error: "price debe ser un número mayor a 0.",
      });
    }

    if (!Number.isInteger(numericQuantity) || numericQuantity <= 0) {
      return res.status(400).json({
        ok: false,
        error: "quantity debe ser un entero mayor a 0.",
      });
    }

    const externalReference = [
      type || "purchase",
      novelId || "general",
      userId || "guest",
      Date.now(),
    ].join("_");

    const preferenceClient = new Preference(mpClient);

    const preferenceData = {
      items: [
        {
          title: String(title),
          quantity: numericQuantity,
          unit_price: numericPrice,
          currency_id: "CLP",
        },
      ],
      external_reference: externalReference,
      payer: email ? { email: String(email) } : undefined,
      back_urls: {
        success: `${FRONTEND_URL}/?mp_status=success`,
        failure: `${FRONTEND_URL}/?mp_status=failure`,
        pending: `${FRONTEND_URL}/?mp_status=pending`,
      },
      auto_return: "approved",
      notification_url: WEBHOOK_URL || undefined,
      metadata: {
        type,
        novelId,
        userId,
        email,
      },
    };

    const result = await preferenceClient.create({ body: preferenceData });

    await db.collection("mp_preferences").add({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      title,
      price: numericPrice,
      quantity: numericQuantity,
      type,
      novelId,
      userId,
      email,
      externalReference,
      preferenceId: result.id || null,
      initPoint: result.init_point || null,
      sandboxInitPoint: result.sandbox_init_point || null,
      status: "created",
    });

    return res.status(200).json({
      ok: true,
      preferenceId: result.id,
      initPoint: result.init_point,
      sandboxInitPoint: result.sandbox_init_point,
      externalReference,
    });
  } catch (error) {
    console.error("Error creando preferencia:", error);

    return res.status(500).json({
      ok: false,
      error: "No se pudo crear la preferencia de pago.",
      detail: error?.message || "Error desconocido",
    });
  }
});

/**
 * Webhook de Mercado Pago
 * Aquí se reciben notificaciones automáticas del pago.
 */
app.post("/webhook", async (req, res) => {
  try {
    await db.collection("mp_webhooks").add({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      body: req.body || null,
      query: req.query || null,
      headers: {
        "x-signature": req.headers["x-signature"] || null,
        "x-request-id": req.headers["x-request-id"] || null,
      },
    });

    return res.status(200).send("ok");
  } catch (error) {
    console.error("Error en webhook:", error);
    return res.status(500).send("error");
  }
});

export const api = onRequest({ cors: true }, app);
