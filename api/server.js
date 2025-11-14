require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();

// --------------------
//  CORS CONFIGURATION
// --------------------
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);  // permite requests internas sin origen

        const allowedOrigins = [
            process.env.SHOPIFY_DOMAIN,
            'https://' + process.env.SHOPIFY_DOMAIN
        ];

        if (
            allowedOrigins.some(allowed => origin.includes(allowed.replace('https://', ''))) ||
            origin.includes('.myshopify.com') ||
            origin.includes('.vercel.app')
        ) {
            callback(null, true);
        } else {
            callback(null, true);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

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
            message: 'El numero de pedido y el correo electronico son obligatorios.'
        });
    }

    try {
        console.log(`🔍 Buscando pedido: ${orderNumber} - Email: ${email}`);

        const response = await axios.get(
            `https://${SHOPIFY_CONFIG.domain}/admin/${SHOPIFY_CONFIG.apiVersion}/orders.json`,
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

        console.log(`📦 Órdenes encontradas: ${response.data.orders.length}`);

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
                message: 'Pedido no encontrado con el numero y correo proporcionados.'
            });
        }

        let coordinadoraTraking = null;

        if (order.fulfillments?.length) {
            for (const fulfillment of order.fulfillments) {
                if (fulfillment.tracking_number) {
                    coordinadoraTraking = fulfillment.tracking_number;
                }
            }
        }

        const formattedOrder = {
            id: order.id,
            orderNumber: order.order_number,
            name: order.name,
            email: order.email,
            createdAt: order.created_at,
            totalPrice: order.total_price,
            currency: order.currency,
            financialStatus: order.financial_status,
            fulfillmentStatus: order.fulfillment_status,
            coordinadoraTraking,
            customer: {
                name: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : 'No disponible',
                email: order.customer?.email || 'No disponible'
            },
            shippingAddress: order.shipping_address || null,
            lineItems: order.line_items?.map(item => ({
                title: item.title,
                quantity: item.quantity,
                price: item.price,
                totalPrice: item.total_price * item.quantity
            })) || [],
            subtotalPrice: order.subtotal_price || '0.00',
            totalDiscounts: order.total_discounts || '0.00',
            totalTax: order.total_tax || '0.00',
            shippingLines: order.shipping_lines || [],
            fulfillments: order.fulfillments?.map(f => ({
                trackingNumber: f.tracking_number,
                trackingUrl: f.tracking_url,
                trackingCompany: f.tracking_company,
                status: f.status
            })) || []
        };

        return res.json({
            success: true,
            order: formattedOrder
        });

    } catch (error) {
        console.error('❌ Error completo:', error);

        if (error.response) {
            return res.status(error.response.status).json({
                success: false,
                message: 'Error al consultar el pedido en Shopify',
                error: error.response.data
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Error interno del servidor',
            error: error.message
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
