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
            'https://villaromana.myshopify.com',
            'https://www.villaromana.com.co',
            'https://villaromana.com.co',
            'https://order-tracker-five-eta.vercel.app',
            process.env.SHOPIFY_DOMAIN ? `https://${process.env.SHOPIFY_DOMAIN}` : null
        ].filter(Boolean);

                console.log('🔐 CORS - Origin recibido:', origin);
        console.log('🔐 CORS - Origins permitidos:', allowedOrigins);
        if (allowedOrigins.some(allowed => origin.includes(allowed.replace('https://', '')))) {
            console.log('✅ CORS - Permitido');
            return callback(null, true);
        }
  if (origin.includes('.vercel.app') || origin.includes('.myshopify.com')) {
            console.log('✅ CORS - Permitido (wildcard)');
            return callback(null, true);
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
    domain: process.env.SHOPIFY_DOMAIN?.toString().trim() || undefined,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN?.toString().trim() || undefined,
    apiVersion: process.env.SHOPIFY_API_VERSION?.toString().trim() || '2025-10'
};

// Log de diagnóstico (no mostrar token completo en producción)
console.log('⚙️ CONFIGURACIÓN CARGADA:');
console.log('  - SHOPIFY_DOMAIN:', JSON.stringify(SHOPIFY_CONFIG.domain));
console.log('  - SHOPIFY_ACCESS_TOKEN set?:', !!SHOPIFY_CONFIG.accessToken ? '✅' : '❌');
console.log('  - SHOPIFY_API_VERSION:', SHOPIFY_CONFIG.apiVersion);

if (!SHOPIFY_CONFIG.domain || !SHOPIFY_CONFIG.accessToken) {
    console.error("❌ ERROR CRÍTICO: Faltan variables de entorno de Shopify. Revisa Vercel > Settings > Environment Variables (Production).");
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
app.get('/api/health', (req, res) => {
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
app.post('/api/search-order', async (req, res) => {
    const { orderNumber, email } = req.body;

    if (!orderNumber || !email) {
        return res.status(400).json({
            success: false,
            message: 'El numero de pedido y el correo electronico son obligatorios.'
        });
    }

    // LOG CONFIG (mask token)
    console.log('⚙️ SHOPIFY_CONFIG:', {
        domain: SHOPIFY_CONFIG.domain || 'MISSING',
        apiVersion: SHOPIFY_CONFIG.apiVersion || 'MISSING',
        accessTokenSet: !!SHOPIFY_CONFIG.accessToken
    });

    if (!SHOPIFY_CONFIG.domain || !SHOPIFY_CONFIG.accessToken || !SHOPIFY_CONFIG.apiVersion) {
        console.error('❌ Configuración incompleta en variables de entorno.');
        return res.status(500).json({
            success: false,
            message: 'Error de configuración del servidor (env variables faltantes).'
        });
    }

    try {
        console.log(`🔍 Buscando pedido: ${orderNumber} - Email: ${email}`);

        const shopifyUrl = `https://${SHOPIFY_CONFIG.domain}/api/admin/${SHOPIFY_CONFIG.apiVersion}/orders.json`;
        console.log('📡 Shopify URL:', shopifyUrl);
        console.log('🔐 Shopify header: X-Shopify-Access-Token set:', !!SHOPIFY_CONFIG.accessToken);

        const response = await axios.get(shopifyUrl, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken,
                'Content-Type': 'application/json'
            },
            params: {
                status: 'any',
                email: email.toLowerCase().trim(),
                limit: 50
            },
            validateStatus: null // para poder loggear status incluso si es 4xx/5xx
        });

        console.log('📊 Shopify response status:', response.status);
        if (response.data && response.data.orders) {
            console.log('📦 Órdenes retornadas:', response.data.orders.length);
        } else {
            console.log('⚠️ Shopify devolvió sin orders o body vacío:', typeof response.data);
        }

        if (!response || response.status >= 400) {
            console.error('🔴 Shopify API error:', {
                status: response?.status,
                data: response?.data
            });
            return res.status(502).json({
                success: false,
                message: 'Error al consultar Shopify',
                shopifyStatus: response?.status,
                // no enviar token ni datos sensibles en producción
                debug: process.env.NODE_ENV !== 'production' ? response?.data : undefined
            });
        }

        const normalizedOrderNumber = orderNumber.replace(/[#\s]/g, '').trim();

        const order = (response.data.orders || []).find(o => {
            const normalizedName = (o.name || '').replace(/[#\s]/g, '').trim();
            return (
                o.order_number?.toString() === normalizedOrderNumber ||
                normalizedName === normalizedOrderNumber
            );
        });

        if (!order) {
            console.log('❌ Orden no encontrada. Listado de names:', (response.data.orders || []).map(o=>o.name));
            return res.json({
                success: false,
                message: 'Pedido no encontrado con el numero y correo proporcionados.'
            });
        }

        // ... formatea la orden como antes ...
        // ...existing code...
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
            coordinadoraTraking: (order.fulfillments || []).find(f=>f.tracking_number)?.tracking_number || null,
            customer: {
                name: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : 'No disponible',
                email: order.customer?.email || 'No disponible'
            },
            shippingAddress: order.shipping_address || null,
            lineItems: (order.line_items || []).map(item => ({
                title: item.title,
                quantity: item.quantity,
                price: item.price,
                totalPrice: (item.total_price || 0) * (item.quantity || 1)
            })),
            subtotalPrice: order.subtotal_price || '0.00',
            totalDiscounts: order.total_discounts || '0.00',
            totalTax: order.total_tax || '0.00',
            shippingLines: order.shipping_lines || [],
            fulfillments: (order.fulfillments || []).map(f => ({
                trackingNumber: f.tracking_number,
                trackingUrl: f.tracking_url,
                trackingCompany: f.tracking_company,
                status: f.status
            }))
        };

        return res.json({ success: true, order: formattedOrder });

    } catch (error) {
        console.error('❌ CATCH - error.message:', error?.message);
        console.error('❌ CATCH - error.stack:', error?.stack);
        console.error('❌ CATCH - error.response?.status:', error?.response?.status);
        console.error('❌ CATCH - error.response?.data:', error?.response?.data);

        return res.status(500).json({
            success: false,
            message: 'Error interno del servidor',
            debug: process.env.NODE_ENV !== 'production' ? (error?.response?.data || error?.message) : undefined
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
