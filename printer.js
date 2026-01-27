const escpos = require('escpos');
// We use a try-catch here so the server doesn't crash if the driver is missing
try {
    escpos.Network = require('escpos-network');
} catch (e) {
    console.warn("⚠️ Hardware Printer Driver not found. Running in simulation mode.");
}

function sendToPrinter(ip, callback) {
    if (!ip || ip === '0.0.0.0' || !escpos.Network) {
        console.log(`[SIMULATION] Sending print job to Virtual Printer at ${ip || 'Unknown IP'}`);
        return;
    }

    try {
        // 1. Create Device
        const device = new escpos.Network(ip, 9100);
        const options = { encoding: "GB18030" };
        const printer = new escpos.Printer(device, options);

        // 2. Open Connection with Error Handling
        device.open((error) => {
            if (error) {
                console.error(`❌ PRINTER ERROR (${ip}): Could not connect.`);
                console.error(`   > Hint: Check if printer is on and IP is correct.`);
                return;
            }
            // 3. Run the print job
            try {
                callback(printer, device);
            } catch (err) {
                console.error("❌ Print Job Failed:", err);
                device.close();
            }
        });

    } catch (e) {
        console.error("❌ Printer Driver Exception:", e.message);
    }
}

function printReceipt(targetIp, cartItems, totalCost) {
    console.log(`\n🧾 === PRINTING RECEIPT [${targetIp}] ===`);
    console.log(`TOTAL: $${totalCost.toFixed(2)}`);
    console.log(`ITEMS: ${cartItems.length}`);
    console.log(`==========================================\n`);
    
    sendToPrinter(targetIp, (printer, device) => {
        printer
            .font('a').align('ct').style('b').size(1, 1)
            .text('E-BUCKS STORE')
            .text('--------------------------------')
            .size(0, 0).align('lt');

        cartItems.forEach(item => {
            printer.text(`${item.name} ... $${item.price.toFixed(2)}`);
        });

        printer
            .align('ct').text('--------------------------------')
            .size(1, 1).text(`TOTAL: $${totalCost.toFixed(2)}`)
            .feed(1).size(0, 0)
            .text(`Date: ${new Date().toLocaleDateString()}`)
            .feed(2).cut().close();
    });
}

function printVoucher(targetIp, voucherData) {
    const ownerName = voucherData.user_name ? voucherData.user_name : "BEARER NOTE";
    
    console.log(`\n💵 === PRINTING VOUCHER [${targetIp}] ===`);
    console.log(`AMOUNT: $${parseFloat(voucherData.amount).toFixed(2)}`);
    console.log(`OWNER: ${ownerName}`);
    console.log(`ID: ${voucherData.id}`);
    console.log(`==========================================\n`);

    sendToPrinter(targetIp, (printer, device) => {
        printer
            .font('a').align('ct').style('b').size(2, 2)
            .text('E-BUCKS')
            .size(0, 0).feed(1)
            .text('OFFICIAL CURRENCY')
            .text('--------------------------------')
            .size(1, 1).text(`$${parseFloat(voucherData.amount).toFixed(2)}`)
            .feed(1).size(0, 0)
            .text(`Owner: ${ownerName}`)
            .feed(1)
            .barcode(voucherData.id, 'CODE39', { width: 2, height: 100 }) 
            .text(voucherData.id)
            .feed(2).cut().close();
    });
}

function printTest(targetIp) {
    console.log(`\n🖨️ TEST PRINT sent to ${targetIp}`);
    sendToPrinter(targetIp, (printer, device) => {
        printer
            .font('a').align('ct').size(1, 1)
            .text('TEST PRINT SUCCESSFUL')
            .feed(2).cut().close();
    });
}

module.exports = { printReceipt, printVoucher, printTest };