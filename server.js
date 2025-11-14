require('dotenv').config();
const express = require ('express');
const axios = require ('axios');
const cors = require ('cors');
const path = require ('path');

const app = express();

// Configuración CORS
const cosrsOptions = {
    origin: function (origin, callback) {
        // Permitir localhost en desarrollo y el dominio en producción
         if (!origin) return callback(null, true);
        const allowedOrigins = [
           process.env.SHOPIFY_DOMAIN,
            'https://' + process.env.SHOPIFY_DOMAIN,
        ];
        
         if (allowedOrigins.some(allowed => origin.includes(allowed.replace('https://', ''))) || 
            origin.includes('.myshopify.com') ||
            origin.includes('.vercel.app')) {
            callback(null, true);
        } else {
            callback(null, true);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(cosrsOptions));
app.options('*', cors(corsOptions));
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
}
app.use((req, res, next) => {
    console.log(`📥 ${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Endpoint: Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        shopifyConfigured: !!(SHOPIFY_CONFIG.domain && SHOPIFY_CONFIG.accessToken),
        shopifyDomain: SHOPIFY_CONFIG.domain,
        apiVersion: SHOPIFY_CONFIG.apiVersion,
        timestamp: new Date().toISOString()
    });
});
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
                limit: 50
            }
        });

        console.log(`Total de órdenes encontradas: ${response.data.orders.length}`);
        console.log(`Buscando orden con número: ${orderNumber}`);
        
        if (response.data.orders && response.data.orders.length > 0) {
            // Mostrar todas las órdenes encontradas para debug
            response.data.orders.forEach(o => {
                console.log(`  - Orden: ${o.name} (order_number: ${o.order_number})`);
            });

            // Filtrar por número de pedido
            const order = response.data.orders.find(o => {
                // Normalizar el número de pedido: remover # y espacios
                const normalizedOrderNumber = orderNumber.replace(/[#\s]/g, '').trim();
                const normalizedName = o.name.replace(/[#\s]/g, '').trim();
                
                return o.order_number.toString() === normalizedOrderNumber || 
                       normalizedName === normalizedOrderNumber;
            });

            if (!order) {
                console.log(`Pedido ${orderNumber} no encontrado en los resultados.`);
                console.log(`Se buscó: order_number === "${orderNumber}" OR name === "${orderNumber}"`);
                return res.json({
                    success: false,
                    message: 'Pedido no encontrado con el numero y correo proporcionados.'
                });
            }

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
                    name: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : 'No disponible',
                    email: order.customer ? order.customer.email : 'No disponible'
                },
                shippingAddress: order.shipping_address || null,
                lineItems: order.line_items && order.line_items.length > 0 ? order.line_items.map(item => ({
                    title: item.title,
                    quantity: item.quantity,
                    price: item.price,
                    totalPrice: item.total_price * item.quantity
                })) : [],
                subtotalPrice: order.subtotal_price || '0.00',
                totalDiscounts: order.total_discounts || '0.00',
                totalTax: order.total_tax || '0.00',
                shippingLines: order.shipping_lines || [],
                fulfillments: order.fulfillments && order.fulfillments.length > 0 ? order.fulfillments.map(f => ({
                    trackingNumber: f.tracking_number,
                    trackingUrl: f.tracking_url,
                    trackingCompany: f.tracking_company,
                    status: f.status
                })) : []
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
        console.error('Error completo:', error);
        console.error('Error al consultar API:', error.message);
        console.error('Stack:', error.stack);

        // Manejo de errores
        if (error.response) {
            // error de la API de Shopify
            console.error('Error response status:', error.response.status);
            console.error('Error response data:', error.response.data);
            return res.status(error.response.status).json({
                success: false,
                message: 'Error al consultar el pedido en Shopify',
                error: error.response.data
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Error interno del servidor al procesar la solicitud.',
            error: error.message
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


// Exportar la app para Vercel
module.exports = app;

    //manejo de errores no capturados

    process.on('unhandledRejection', (error) => {
        console.error('Unhandled Rejection:', error);
    });