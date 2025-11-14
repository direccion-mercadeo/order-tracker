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
    apiVersion: process.env.SHOPIFY_API_VERSION?.toString().trim() || '2024-10'  // ⭐ CAMBIAR A 2024-10
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
//    DEBUG TOKEN ENDPOINT
// ----------------------------
app.get('/api/debug-token', async (req, res) => {
    try {
        console.log('\n🔍 ========== DEBUG TOKEN ==========');
        console.log('📡 Domain:', SHOPIFY_CONFIG.domain);
        console.log('📡 API Version:', SHOPIFY_CONFIG.apiVersion);
        console.log('🔐 Token configurado:', !!SHOPIFY_CONFIG.accessToken);
        console.log('🔐 Token primeros 10 chars:', SHOPIFY_CONFIG.accessToken?.substring(0, 10));
        console.log('🔐 Token últimos 10 chars:', SHOPIFY_CONFIG.accessToken?.substring(SHOPIFY_CONFIG.accessToken.length - 10));
        
        const shopifyUrl = `https://${SHOPIFY_CONFIG.domain}/api/admin/${SHOPIFY_CONFIG.apiVersion}/shop.json`;
        console.log('📡 URL completa:', shopifyUrl);
        
        const response = await axios.get(shopifyUrl, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });

        console.log('✅ Respuesta 200 OK');
        console.log('🏪 Shop:', response.data?.shop?.name);
        console.log('📊 Plan:', response.data?.shop?.plan_name);
        
        return res.json({
            success: true,
            message: 'Token es válido y tiene permisos',
            status: response.status,
            shop: response.data?.shop?.name || 'Unknown',
            plan: response.data?.shop?.plan_name || 'Unknown',
            shopData: response.data?.shop
        });

    } catch (error) {
        console.error('\n❌ ========== ERROR ==========');
        console.error('❌ Status:', error.response?.status);
        console.error('❌ StatusText:', error.response?.statusText);
        console.error('❌ URL:', error.config?.url);
        console.error('❌ Headers enviados:', {
            'X-Shopify-Access-Token': error.config?.headers?.['X-Shopify-Access-Token'] ? '***' : 'NO ENVIADO',
            'Content-Type': error.config?.headers?.['Content-Type']
        });
        console.error('❌ Respuesta completa:', JSON.stringify(error.response?.data, null, 2));
        console.error('❌ Mensaje de error:', error.message);
        
        if (error.code === 'ECONNREFUSED') {
            return res.status(503).json({
                success: false,
                message: 'No se puede conectar a Shopify',
                status: 503,
                error: error.message
            });
        }

        if (error.response?.status === 401) {
            return res.status(401).json({
                success: false,
                message: 'Token inválido, expirado o sin permisos (401)',
                status: 401,
                hint: 'Regenera el token en Shopify Admin con permisos: read_orders, read_customers',
                tokenLength: SHOPIFY_CONFIG.accessToken?.length
            });
        }

        if (error.response?.status === 404) {
            return res.status(404).json({
                success: false,
                message: 'Endpoint no encontrado (404) - Posibles causas: API version incorrecta, dominio incorrecto, o tienda no existe',
                status: 404,
                debug: {
                    domain: SHOPIFY_CONFIG.domain,
                    apiVersion: SHOPIFY_CONFIG.apiVersion,
                    url: error.config?.url
                }
            });
        }

        return res.status(error.response?.status || 500).json({
            success: false,
            message: 'Error desconocido al conectar con Shopify',
            status: error.response?.status || error.code,
            error: error.response?.data,
            hint: 'Verifica que el dominio y token sean correctos'
        });
    }
});

// ----------------------------
//    TEST API VERSIONS
// ----------------------------
app.get('/api/test-api-versions', async (req, res) => {
    console.log('🧪 Iniciando prueba de versiones API...');
    console.log('📡 Domain:', SHOPIFY_CONFIG.domain);
    console.log('🔐 Token:', SHOPIFY_CONFIG.accessToken ? '***' + SHOPIFY_CONFIG.accessToken.slice(-10) : 'NO CONFIGURADO');
    
    const versionsToTest = ['2024-10', '2024-07', '2024-04', '2024-01', '2023-10', '2023-07'];
    const results = {};

    for (const version of versionsToTest) {
        try {
            const url = `https://${SHOPIFY_CONFIG.domain}/api/admin/${version}/shop.json`;
            console.log(`\n🔗 Probando ${version}...`);
            console.log(`   URL: ${url}`);
            
            const response = await axios.get(url, {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken,
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            });
            results[version] = { 
                status: 'OK', 
                code: response.status,
                shop: response.data?.shop?.name
            };
            console.log(`✅ ${version}: FUNCIONA - Shop: ${response.data?.shop?.name}`);
        } catch (error) {
            const status = error.response?.status || error.code;
            results[version] = { 
                status: 'FAILED', 
                code: status,
                error: error.response?.statusText || error.message
            };
            console.log(`❌ ${version}: ${status} - ${error.response?.statusText || error.message}`);
            
            if (error.response?.data) {
                console.log('   Detalles:', JSON.stringify(error.response.data, null, 2));
            }
        }
    }

    return res.json({
        success: true,
        message: 'Resultados de prueba de versiones API',
        domain: SHOPIFY_CONFIG.domain,
        tokenConfigured: !!SHOPIFY_CONFIG.accessToken,
        results
    });
});

//-----------
// token debug
//-----------
app.get('/api/debug-orders/:email', async (req, res) => {
    const { email } = req.params;

    try {
        console.log(`🔍 DEBUG: Listando órdenes para email: ${email}`);

        const shopifyUrl = `https://${SHOPIFY_CONFIG.domain}/api/admin/${SHOPIFY_CONFIG.apiVersion}/orders.json`;
        console.log('📡 URL:', shopifyUrl);
        console.log('📋 Parámetros:', { email, status: 'any', limit: 10 });

        const response = await axios.get(shopifyUrl, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken,
                'Content-Type': 'application/json'
            },
            params: {
                status: 'any',
                email: email.toLowerCase().trim(),
                limit: 10
            }
        });

        console.log('✅ Órdenes encontradas:', response.data.orders?.length || 0);

        return res.json({
            success: true,
            count: response.data.orders?.length || 0,
            orders: (response.data.orders || []).map(o => ({
                id: o.id,
                name: o.name,
                order_number: o.order_number,
                email: o.email,
                created_at: o.created_at,
                total_price: o.total_price
            }))
        });

    } catch (error) {
        console.error('❌ Error listando órdenes:');
        console.error('   Status:', error.response?.status);
        console.error('   Data:', JSON.stringify(error.response?.data, null, 2));

        return res.status(error.response?.status || 500).json({
            success: false,
            message: 'Error al obtener órdenes',
            status: error.response?.status,
            error: error.response?.data
        });
    }
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
        console.log('📡 URL completa:', shopifyUrl);
        console.log('📋 Parámetros:', {
            status: 'any',
            email: email.toLowerCase().trim(),
            limit: 50
        });
        console.log('🔐 Token presente:', !!SHOPIFY_CONFIG.accessToken);
        console.log('🔐 Token primeros 10 chars:', SHOPIFY_CONFIG.accessToken?.substring(0, 10));

        const response = await axios.get(shopifyUrl, {
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

        console.log('✅ Respuesta de Shopify - Status:', response.status);
        console.log('✅ Órdenes retornadas:', response.data?.orders?.length || 0);

        if (!response.data?.orders || response.data.orders.length === 0) {
            console.log('⚠️ No hay órdenes para este email');
            return res.json({
                success: false,
                message: 'No se encontraron órdenes para este correo electrónico.'
            });
        }

        const normalizedOrderNumber = orderNumber.replace(/[#\s]/g, '').trim();
        console.log('🔄 Número normalizado:', normalizedOrderNumber);

        const order = (response.data.orders || []).find(o => {
            const normalizedName = (o.name || '').replace(/[#\s]/g, '').trim();
            const match = o.order_number?.toString() === normalizedOrderNumber || normalizedName === normalizedOrderNumber;
            if (match) console.log('✅ Orden encontrada:', o.name);
            return match;
        });

        if (!order) {
            console.log('❌ Orden NO encontrada');
            console.log('📌 Órdenes disponibles:', (response.data.orders || []).map(o => ({ name: o.name, order_number: o.order_number })));
            return res.json({
                success: false,
                message: 'Pedido no encontrado con el numero y correo proporcionados.'
            });
        }

        console.log('📦 Procesando datos de la orden...');

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
            coordinadoraTraking: (order.fulfillments || []).find(f => f.tracking_number)?.tracking_number || null,
            customer: {
                name: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : 'No disponible',
                email: order.customer?.email || 'No disponible'
            },
            shippingAddress: order.shipping_address || null,
            lineItems: (order.line_items || []).map(item => ({
                title: item.title || 'Sin título',
                quantity: item.quantity || 0,
                price: item.price || '0',
                totalPrice: ((item.total_price || 0) * (item.quantity || 1)).toFixed(2)
            })),
            subtotalPrice: order.subtotal_price || '0.00',
            totalDiscounts: order.total_discounts || '0.00',
            totalTax: order.total_tax || '0.00',
            shippingLines: (order.shipping_lines || []).map(s => ({
                title: s.title || 'Envío',
                price: s.price || '0'
            })),
            fulfillments: (order.fulfillments || []).map(f => ({
                trackingNumber: f.tracking_number,
                trackingUrl: f.tracking_url,
                trackingCompany: f.tracking_company,
                status: f.status
            }))
        };

        console.log('✅ === BÚSQUEDA EXITOSA ===');
        return res.json({
            success: true,
            order: formattedOrder
        });

    } catch (error) {
        console.error('❌ CATCH - error.message:', error?.message);
        console.error('❌ CATCH - error.code:', error?.code);
        console.error('❌ CATCH - error.response?.status:', error?.response?.status);
        console.error('❌ CATCH - error.response?.statusText:', error?.response?.statusText);
        console.error('❌ CATCH - error.response?.data:', JSON.stringify(error?.response?.data, null, 2));
        console.error('❌ CATCH - error.config?.url:', error?.config?.url);
        console.error('❌ CATCH - error.config?.headers:', error?.config?.headers);

        if (error.response?.status === 404) {
            console.error('🔴 ERROR 404: El endpoint no existe o el token no tiene permisos');
            console.error('   Verifica:');
            console.error('   1. El token tenga permisos read_orders');
            console.error('   2. La API version 2024-10 sea válida para tu tienda');
            console.error('   3. El dominio sea correcto: villaromana.myshopify.com');
        }

        if (error.response?.status === 401) {
            console.error('🔴 ERROR 401: Token inválido o expirado');
        }

        return res.status(error.response?.status || 500).json({
            success: false,
            message: 'Error al consultar Shopify',
            shopifyStatus: error.response?.status,
            shopifyError: error.response?.data
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
