require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const serverless = require('serverless-http'); // <-- NECESARIO

const app = express();

// CORS
app.use(cors({
    origin: [
        'https://villaromana.com.co',
        'https://villaromana.myshopify.com'
    ],
    credentials: true
}));

app.use(express.json());

// Shopify config
const SHOPIFY_CONFIG = {
    domain: process.env.SHOPIFY_DOMAIN,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    apiVersion: process.env.SHOPIFY_API_VERSION || '2025-10'
};

// --- ENDPOINTS --- //

// Health
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        shopifyConfigured: !!(SHOPIFY_CONFIG.domain && SHOPIFY_CONFIG.accessToken)
    });
});

// Search order
app.post('/api/search-order', async (req, res) => {
    const { orderNumber, email } = req.body;

    if (!orderNumber || !email) {
        return res.status(400).json({ success: false, message: "Faltan datos" });
    }

    try {
        const response = await axios.get(
            `https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/orders.json`,
            {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken
                },
                params: {
                    status: 'any',
                    email: email.toLowerCase().trim(),
                    limit: 50
                }
            }
        );

        const order = response.data.orders.find(o =>
            o.order_number == orderNumber ||
            o.name.replace(/#/g, '') == orderNumber
        );

        if (!order) {
            return res.json({ success: false, message: "Pedido no encontrado" });
        }

        res.json({ success: true, order });

    } catch (err) {
        console.error(err.response?.data || err);
        res.status(500).json({ success: false, message: "Error consultando Shopify" });
    }
});

// Exportar para Vercel
module.exports = serverless(app);
