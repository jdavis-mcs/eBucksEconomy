// printer.js - HTML Generator Version

function wrapHtml(content) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Print</title>
        <style>
            body { 
                font-family: 'Courier New', monospace; 
                width: 300px; /* Standard 80mm thermal width */
                margin: 0 auto; 
                color: #000;
                font-size: 14px;
            }
            .bold { font-weight: bold; }
            .center { text-align: center; }
            .left { text-align: left; }
            .right { text-align: right; }
            .row { display: flex; justify-content: space-between; }
            .divider { border-top: 1px dashed #000; margin: 10px 0; }
            /* This ensures the printer cuts or starts a new page between receipts */
            .cut { page-break-after: always; padding-bottom: 20px; border-bottom: 1px dotted #ccc; margin-bottom: 20px; }
            img { max-width: 100%; }
        </style>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
    </head>
    <body>
        ${content}
        <script>
            // Generate Barcodes
            try { JsBarcode(".barcode").init(); } catch(e) {}
            // Auto-print
            window.onload = function() { window.print(); };
        </script>
    </body>
    </html>
    `;
}

function generateReceipt(cartItems, totalCost) {
    let itemsHtml = cartItems.map(item => `
        <div class="row">
            <span>${item.name}</span>
            <span>$${item.price.toFixed(2)}</span>
        </div>
    `).join('');

    const content = `
        <div class="cut">
            <h2 class="center bold">E-BUCKS STORE</h2>
            <div class="divider"></div>
            <div class="left">${itemsHtml}</div>
            <div class="divider"></div>
            <div class="row bold">
                <span>TOTAL:</span>
                <span>$${totalCost.toFixed(2)}</span>
            </div>
            <br/>
            <div class="center" style="font-size:10px;">${new Date().toLocaleString()}</div>
            <br/>
            <div class="center">Thank you!</div>
        </div>
    `;
    // Note: We return raw div content here, wrapHtml is called at the end
    return content;
}

function generateVoucher(voucherData) {
    const ownerName = voucherData.user_name ? voucherData.user_name : "BEARER NOTE";
    
    return `
        <div class="cut">
            <h1 class="center bold">E-BUCKS</h1>
            <div class="center">OFFICIAL CHANGE</div>
            <div class="divider"></div>
            <h2 class="center bold" style="font-size: 24px;">$${parseFloat(voucherData.amount).toFixed(2)}</h2>
            <div class="center">Owner: ${ownerName}</div>
            <br/>
            <div class="center">
                <svg class="barcode"
                    jsbarcode-format="CODE39"
                    jsbarcode-value="${voucherData.id}"
                    jsbarcode-width="2"
                    jsbarcode-height="60"
                    jsbarcode-displayValue="true">
                </svg>
            </div>
            <br/>
        </div>
    `;
}

// Combines multiple HTML snippets into one printable page
function combinePrints(htmlContentArray) {
    return wrapHtml(htmlContentArray.join(''));
}

module.exports = { generateReceipt, generateVoucher, combinePrints };