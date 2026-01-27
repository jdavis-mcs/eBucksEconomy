// Replace printer.js with this inside the lab.
//
//
//
// Replace printer.js with this inside the lab.
// Replace printer.js with this inside the lab.
//
//
//
// Replace printer.js with this inside the lab.

const escpos = require('escpos');
// WE MUST IMPORT THE NETWORK ADAPTER SEPARATELY
escpos.Network = require('escpos-network');

// REPLACE '192.168.0.123' WITH YOUR ACTUAL PRINTER IP
const device = new escpos.Network('192.168.0.123', 9100);

const options = { encoding: "GB18030" };
const printer = new escpos.Printer(device, options);

// Print a Receipt (Cart Items)
function printReceipt(cartItems, totalCost) {
    try {
        device.open(function(error){
            if(error) {
                console.error("Printer Network Error (Receipt):", error);
                // If it fails, we still want the server to stay alive
                return;
            }

            printer
                .font('a')
                .align('ct')
                .style('b')
                .size(1, 1)
                .text('E-BUCKS STORE')
                .text('--------------------------------')
                .size(0, 0)
                .align('lt');

            cartItems.forEach(item => {
                printer.text(`${item.name} ... $${item.price.toFixed(2)}`);
            });

            printer
                .align('ct')
                .text('--------------------------------')
                .size(1, 1)
                .text(`TOTAL: $${totalCost.toFixed(2)}`)
                .feed(1)
                .size(0, 0)
                .text(`Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`)
                .feed(2)
                .cut()
                .close();
        });
    } catch (e) {
        console.error("Printer Exception:", e);
    }
}

// Print a Voucher (Money)
function printVoucher(voucherData) {
    const ownerName = voucherData.user_name ? voucherData.user_name : "BEARER NOTE";

    try {
        device.open(function(error){
            if(error) {
                console.error("Printer Network Error (Voucher):", error);
                return;
            }

            printer
                .font('a')
                .align('ct')
                .style('b')
                .size(2, 2)
                .text('E-BUCKS')
                .size(0, 0)
                .feed(1)
                .text('OFFICIAL CURRENCY')
                .text('--------------------------------')
                .size(1, 1)
                .text(`$${parseFloat(voucherData.amount).toFixed(2)}`)
                .feed(1)
                .size(0, 0)
                .text(`Owner: ${ownerName}`)
                .feed(1)
                .barcode(voucherData.id, 'CODE39', { width: 2, height: 100 }) 
                .text(voucherData.id)
                .feed(2)
                .cut()
                .close();
        });
    } catch (e) {
        console.error("Printer Exception:", e);
    }
}

module.exports = { printReceipt, printVoucher };