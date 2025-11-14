require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();

// --------------------
//  CORS CONFIGURATION
// --------------------
const allowedOrigins = [
    `https://${process.env.SHOPIFY_DOMAIN}`,
    process.env.FRONTEND_URL,
];

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);

        const allowed = allowedOrigins.some(o => origin.includes(o)) ||
                        origin.includes('.vercel.app') ||
                        origin.includes('.myshopify.com');

        if (allowed) return callback(null, true);
        return callback(new Error("CORS no permitido"));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// --------------------
//   RATE LIMITING
// --------------------
app.use('/search-order', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    message: { success: false, message: "Demasiadas consultas. Intenta más tarde." }
}));

// --------------------
//    SHOPIFY CONFIG
// --------------------
const SHOPIFY_CONFIG = {
    domain: process.env.SHOPIFY_DOMAIN,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    apiVersion: process.env.SHOPIFY_API_VERSION
};

if (!SHOPIFY_CONFIG.domain || !SHOPIFY_CONFIG.accessToken) {
    console.error("❌ Error: faltan variables de entorno de Shopify.");
}

// --------------------
//   REQUEST LOGGER
// --------------------
app.use((req, res, next) => {
    console.log(`📥 ${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// --------------------
//       HEALTH
// --------------------
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        shopifyConfigured: !!(SHOPIFY_CONFIG.domain && SHOPIFY_CONFIG.accessToken),
        shopifyDomain: SHOPIFY_CONFIG.domain,
        apiVersion: SHOPIFY_CONFIG.apiVersion,
        timestamp: new Date().toISOString()
    });
});

// ----------------------------
//    SEARCH ORDER ENDPOINT
// ----------------------------
app.post('/search-order', async (req, res) => {
    const { orderNumber, email } = req.body;

    if (!orderNumber || !email) {
        return res.status(400).json({
            success: false,
            message: 'El número de pedido y el correo electrónico son obligatorios.'
        });
    }

    try {
        console.log(`🔍 Buscando pedido: ${orderNumber} - Email: ${email}`);

        const response = await axios.get(
            `https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/orders.json`,
            {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken,
                    'Content-Type': 'application/json'
                },
                params: {
                    status: 'any',
                    email: email.toLowerCase().trim(),
                    limit: 50
                }
            }
        );

        const normalizedOrderNumber = orderNumber.replace(/[#\s]/g, '').trim();

        const order = response.data.orders.find(o => {
            const normalizedName = o.name.replace(/[#\s]/g, '').trim();
            return (
                o.order_number?.toString() === normalizedOrderNumber ||
                normalizedName === normalizedOrderNumber
            );
        });

        if (!order) {
            return res.json({
                success: false,
                message: 'Pedido no encontrado con el número y correo proporcionados.'
            });
        }

        // Buscar tracking
        const tracking = order.fulfillments?.find(f => f.tracking_number);

        const formattedOrder = {
            id: order.id,
            orderNumber: order.order_number,
            name: order.name,
            createdAt: order.created_at,
            coordinadoraTracking: tracking?.tracking_number || null,
            fulfillmentStatus: order.fulfillment_status,
            lineItems: order.line_items?.map(item => ({
                title: item.title,
                quantity: item.quantity,
                price: item.price,
                totalPrice: Number(item.price) * item.quantity
            })),
            shippingAddress: order.shipping_address
        };

        return res.json({ success: true, order: formattedOrder });

    } catch (error) {
        console.error("❌ Error Shopify:", error.response?.data || error.message);

        return res.status(error.response?.status || 500).json({
            success: false,
            message: 'Error al consultar el pedido en Shopify',
            error: error.response?.data || error.message
        });
    }
});

// ----------------------------
//   UPDATE ORDER STATUS
// ----------------------------
app.post('/update-status', async (req, res) => {
    const { orderId } = req.body;

    if (!orderId) {
        return res.status(400).json({
            success: false,
            message: 'El ID del pedido es obligatorio.'
        });
    }

    try {
        console.log(`📦 Actualizando estado del pedido ${orderId} → "prepared"`);

        const payload = {
            order: {
                id: orderId,
                fulfillment_status: "fulfilled"
            }
        };

        const response = await axios.put(
            `https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/orders/${orderId}.json`,
            payload,
            {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken,
                    'Content-Type': 'application/json'
                }
            }
        );

        return res.json({
            success: true,
            message: 'Estado actualizado correctamente',
            data: response.data
        });

    } catch (error) {
        console.error("❌ Error al actualizar estado:", error.response?.data || error.message);

        return res.status(error.response?.status || 500).json({
            success: false,
            message: 'Error al actualizar estado en Shopify',
            error: error.response?.data || error.message
        });
    }
});

// --------------------
//  ROOT PAGE (HTML)
// --------------------
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// --------------------
//     EXPORT FOR VERCEL
// --------------------
module.exports = app;

// --------------------------
//  UNHANDLED REJECTIONS LOG
// --------------------------
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});
