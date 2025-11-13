require('dotenv').config();
const express = require ('express');
const axios = require ('axios');
const cors = require ('cors');
const path = require ('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración CORS
const cosrsOptions = {
    origin: function (origin, callback) {
        // Permitir localhost en desarrollo y el dominio en producción
        const allowedOrigins = [
            'https://villaromana.com.co',
            'http://localhost:3000',
            'http://localhost:5000'
        ];
        
        if (!origin || allowedOrigins.indexOf(origin) > -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(cosrsOptions));
app.use(express.json());
app.use(express.static('public'));



//Configuracion de Shopify

const SHOPIFY_CONFIG = {
    domain: process.env.SHOPIFY_DOMAIN,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    apiVersion: process.env.SHOPIFY_API_VERSION
};

if(!SHOPIFY_CONFIG.domain || !SHOPIFY_CONFIG.accessToken) {
    console.error("Error: faltan variables de entorno de Shopify.");
    process.exit(1);
}

//Endpoint: Buscar pedido

app.post('/api/search-order', async (req, res) => {
    const {orderNumber, email} = req.body;

    //Validacion de entrada
    if (!orderNumber || !email) {
        return res.status(400).json({
            success: false,
            message: 'El numero de pedido y el correo electronico son obligatorios.'
        });
    }
    try {
            console.log(`Buscando pedido ${orderNumber} para el correo ${email}`);

        //Consultar Shopify API

        const response = await axios.get(`https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/orders.json`, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken,
                'Content-Type': 'application/json'
            },
            params: {
                status: 'any',
                email: email.toLowerCase().trim(),
                name: orderNumber.toString(),
                limit: 1
            }
        });

        //Verificar si se encontró el pedido
        if (response.data.orders && response.data.orders.length > 0) {
            const order = response.data.orders[0];

            let coordinadoraTraking = null;

            if (order.fulfillments && order.fulfillments.length > 0) {
                for (const fulfillment of order.fulfillments) {
                    if (fulfillment.tracking_number) {
                        coordinadoraTraking = fulfillment.tracking_number;
                        console.log('Traking encontrado en fulfillment.tracking_number:', coordinadoraTraking);
                    }
                }
            }

            //Formatear respuestas con datos relevantes del pedido
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
                coordinadoraTraking: coordinadoraTraking,
                customer: {
                    name : `${order.customer.first_name} ${order.customer.last_name}`,
                    email: order.customer.email
                },
                shippingAddress: order.shipping_address,
                lineItems: order.line_items.map(item => ({
                    title: item.title,
                    quantity: item.quantity,
                    price: item.price,
                    totalPrice: item.total_price * item.quantity
                })),
                subtotalPrice: order.subtotal_price,
                totalDiscounts: order.total_discounts,
                totalTax: order.total_tax,
                shippingLines: order.shipping_lines,
                fulfillments: order.fulfillments.map(f => ({
                    trackingNumber: f.tracking_number,
                    trackingUrl: f.tracking_url,
                    trackingCompany: f.tracking_company,
                    status: f.status
                }))
            };

            console.log(`Pedido ${orderNumber} encontrado.`);
            return res.json({
                success: true,
                order: formattedOrder
            });
        } else {
            console.log(`Pedido ${orderNumber} no encontrado.`);
            return res.json({
                success: false,
                message: 'Pedido no encontrado con el numero y correo proporcionados.'
            });
        }

    } catch (error) {
        console.error('Error al consultar API:', error.message);

        // Manejo de errores
        if (error.response) {
            // error de la API de Shopify
            return res.status(error.response.status).json({
                success: false,
                message: 'Error al consultar el pedido',
                error: error.response.data
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Error interno del servidor al procesar la solicitud.'
        });
    }
});

//Endpoint: Health check

app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        shopifyConfigured: !!(SHOPIFY_CONFIG.domain && SHOPIFY_CONFIG.accessToken), 
        timestamp: new Date().toISOString()
    });
});

//pagina principal 
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

//Iniciar el servidor
app.listen (PORT, () => {
    console.log(`
    ╔════════════════════════════════════════╗
    ║   🚀 Order Tracker Server Running     ║
    ╠════════════════════════════════════════╣
    ║   Port: ${PORT}                       ║
    ║   Environment: ${process.env.NODE_ENV || 'development'}          ║
    ║   Shopify Store: ${SHOPIFY_CONFIG.domain}  ║
    ╚════════════════════════════════════════╝
    📍 Local: http://localhost:${PORT}
    🔧 Health: http://localhost:${PORT}/api/health
    `);
    });

    //manejo de errores no capturados

    process.on('unhandledRejection', (error) => {
        console.error('Unhandled Rejection:', error);
    });
