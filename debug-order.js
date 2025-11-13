require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

const SHOPIFY_CONFIG = {
    domain: process.env.SHOPIFY_DOMAIN,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    apiVersion: process.env.SHOPIFY_API_VERSION || '2024-01'
};

console.log('🔍 Script de Debug - Buscar Número de Guía de Coordinadora\n');
console.log('Domain:', SHOPIFY_CONFIG.domain);
console.log('API Version:', SHOPIFY_CONFIG.apiVersion);
console.log('Token configurado:', SHOPIFY_CONFIG.accessToken ? '✅' : '❌');
console.log('\n' + '='.repeat(60) + '\n');

// Pide el número de orden
const orderNumber = process.argv[2];
const email = process.argv[3];

if (!orderNumber || !email) {
    console.log('❌ Uso: node debug-order.js [numero_orden] [email]');
    console.log('Ejemplo: node debug-order.js 4715ECOMM javierbastidasmora@hotmail.com');
    process.exit(1);
}

async function debugOrder() {
    try {
        console.log(`Buscando orden: ${orderNumber} para email: ${email}\n`);
        
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
                    name: orderNumber.toString(),
                    limit: 1
                }
            }
        );

        if (response.data.orders && response.data.orders.length > 0) {
            const order = response.data.orders[0];
            
            console.log('✅ ORDEN ENCONTRADA\n');
            console.log('='.repeat(60));
            console.log(`Orden: ${order.name} (ID: ${order.id})`);
            console.log(`Cliente: ${order.customer.first_name} ${order.customer.last_name}`);
            console.log(`Email: ${order.email}`);
            console.log(`Estado: ${order.fulfillment_status || 'unfulfilled'}`);
            console.log('='.repeat(60) + '\n');

            // Analizar FULFILLMENTS
            console.log('📦 FULFILLMENTS:');
            console.log('-'.repeat(60));
            if (order.fulfillments && order.fulfillments.length > 0) {
                order.fulfillments.forEach((f, index) => {
                    console.log(`\nFulfillment #${index + 1}:`);
                    console.log(`  ID: ${f.id}`);
                    console.log(`  Status: ${f.status}`);
                    console.log(`  Tracking Number: ${f.tracking_number || 'N/A'}`);
                    console.log(`  Tracking Company: ${f.tracking_company || 'N/A'}`);
                    console.log(`  Tracking URL: ${f.tracking_url || 'N/A'}`);
                    console.log(`  Tracking URLs: ${JSON.stringify(f.tracking_urls)}`);
                    
                    if (f.tracking_company && f.tracking_company.toLowerCase().includes('coordinadora')) {
                        console.log('  ⭐ COORDINADORA DETECTADA!');
                    }
                });
            } else {
                console.log('  No hay fulfillments');
            }
            console.log('\n' + '-'.repeat(60) + '\n');

            // Analizar NOTAS
            console.log('📝 NOTAS DEL PEDIDO:');
            console.log('-'.repeat(60));
            if (order.note) {
                console.log(order.note);
                
                const match = order.note.match(/Seguimiento de Coordinadora:\s*(\d+)/i);
                if (match) {
                    console.log(`\n⭐ NÚMERO DE GUÍA ENCONTRADO EN NOTAS: ${match[1]}`);
                }
            } else {
                console.log('  Sin notas');
            }
            console.log('\n' + '-'.repeat(60) + '\n');

            // Analizar NOTE ATTRIBUTES
            console.log('🏷️  NOTE ATTRIBUTES:');
            console.log('-'.repeat(60));
            if (order.note_attributes && order.note_attributes.length > 0) {
                order.note_attributes.forEach((attr, index) => {
                    console.log(`  ${index + 1}. ${attr.name}: ${attr.value}`);
                    
                    if (attr.name && (
                        attr.name.toLowerCase().includes('coordinadora') ||
                        attr.name.toLowerCase().includes('guia') ||
                        attr.name.toLowerCase().includes('tracking')
                    )) {
                        console.log(`     ⭐ POSIBLE NÚMERO DE GUÍA!`);
                    }
                });
            } else {
                console.log('  Sin note attributes');
            }
            console.log('\n' + '-'.repeat(60) + '\n');

            // Analizar TAGS
            console.log('🏷️  TAGS:');
            console.log('-'.repeat(60));
            if (order.tags) {
                console.log(`  ${order.tags}`);
                
                const match = order.tags.match(/coordinadora[:\s]*(\d+)/i);
                if (match) {
                    console.log(`  ⭐ NÚMERO DE GUÍA ENCONTRADO EN TAGS: ${match[1]}`);
                }
            } else {
                console.log('  Sin tags');
            }
            console.log('\n' + '-'.repeat(60) + '\n');

            // Analizar SHIPPING LINES
            console.log('🚚 SHIPPING LINES:');
            console.log('-'.repeat(60));
            if (order.shipping_lines && order.shipping_lines.length > 0) {
                order.shipping_lines.forEach((line, index) => {
                    console.log(`\nShipping Line #${index + 1}:`);
                    console.log(`  Title: ${line.title}`);
                    console.log(`  Code: ${line.code || 'N/A'}`);
                    console.log(`  Source: ${line.source || 'N/A'}`);
                    console.log(`  Price: ${line.price}`);
                    
                    if (line.title && line.title.toLowerCase().includes('coordinadora')) {
                        console.log(`  ⭐ COORDINADORA DETECTADA!`);
                    }
                });
            } else {
                console.log('  Sin shipping lines');
            }
            console.log('\n' + '-'.repeat(60) + '\n');

            // Guardar JSON completo
            const filename = `order-${order.order_number}-debug.json`;
            fs.writeFileSync(filename, JSON.stringify(order, null, 2));
            console.log(`\n💾 JSON completo guardado en: ${filename}`);
            console.log('   Puedes revisar este archivo para encontrar el número de guía');
            
            console.log('\n' + '='.repeat(60));
            console.log('🔍 RESUMEN DE BÚSQUEDA:');
            console.log('='.repeat(60));
            
            let found = false;
            
            // Buscar en todos los lugares
            if (order.fulfillments && order.fulfillments.length > 0) {
                for (const f of order.fulfillments) {
                    if (f.tracking_number) {
                        console.log(`✅ Tracking encontrado en fulfillments: ${f.tracking_number}`);
                        found = true;
                    }
                }
            }
            
            if (order.note) {
                const match = order.note.match(/Seguimiento de Coordinadora:\s*(\d+)/i);
                if (match) {
                    console.log(`✅ Guía encontrada en notas: ${match[1]}`);
                    found = true;
                }
            }
            
            if (!found) {
                console.log('❌ No se encontró número de guía de Coordinadora');
                console.log('   Revisa el archivo JSON para encontrarlo manualmente');
            }
            
        } else {
            console.log('❌ No se encontró la orden');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        }
    }
}

debugOrder();