// CONFIGURATION
// Add the EXACT names of items from your database you want to show here.
const ALLOWED_ITEMS = [
    "Diamond Sword", 
    "Golden Apple", 
    "Redstone Dust",
    "Potion of Healing",
    "Snacks", // Example generic item
    "Water, 20oz"
];

let selectedItem = null;
let inventory = [];

// 1. Fetch Inventory on Load
async function loadInventory() {
    try {
        const res = await fetch('/api/inventory');
        const data = await res.json();
        
        // Filter inventory to only show items in our allow list
        inventory = data.filter(item => ALLOWED_ITEMS.includes(item.name) && item.stock > 0);
        renderTradeList();
    } catch (e) {
        console.error("Failed to load inventory", e);
    }
}

// 2. Render the Left Side List
function renderTradeList() {
    const list = document.getElementById('tradeList');
    list.innerHTML = '';

    inventory.forEach(item => {
        const li = document.createElement('li');
        li.className = 'trade-item';
        li.innerHTML = `
            <div class="trade-cost">
                <div class="emerald-icon"></div>
                <span>${item.price}</span>
            </div>
            <div class="arrow-indicator" style="font-size: 20px; margin: 0 10px;">→</div>
            <span class="item-name">${item.name}</span>
        `;
        
        li.onclick = () => selectTrade(item, li);
        list.appendChild(li);
    });
}

// 3. Handle Item Selection
function selectTrade(item, element) {
    selectedItem = item;
    
    // UI Updates
    document.querySelectorAll('.trade-item').forEach(el => el.classList.remove('active'));
    element.classList.add('active');
    
    document.getElementById('totalCostDisplay').innerText = item.price;
    document.getElementById('cartPreview').innerText = item.name.substring(0, 2); // Simple icon placeholder
    
    document.getElementById('tradeButton').disabled = false;
    document.getElementById('voucherInput').focus();
    
    // Play sound (Optional)
    const audio = document.getElementById('villagerSound');
    if(audio) audio.play().catch(e => console.log("Audio needs user interaction first"));
}

// 4. Handle "Trading" (Purchasing)
document.getElementById('tradeButton').addEventListener('click', async () => {
    // 1. Get the Input
    const voucherInput = document.getElementById('voucherInput');
    const voucherCode = voucherInput.value.trim();
    
    // 2. Validation
    if (!selectedItem) {
        alert("Hrrrm? (You must select an item first!)"); 
        return;
    }
    if (!voucherCode) {
        alert("Hrrrm! (You must scan an emerald/voucher!)");
        voucherInput.focus();
        return;
    }

    // 3. Prepare Payload
    // Note: The server expects an array of items, even if it's just one
    const payload = {
        voucherIds: [voucherCode], 
        totalCost: selectedItem.price,
        cartItems: [selectedItem] // Sending the full item object
    };

    try {
        // 4. Send Request
        const res = await fetch('/api/purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await res.json();

        // 5. Handle Success & Printing
        if (result.success) {
            // A. Handle Printing if the server sent print data
            if (result.printWindow) {
                const printWin = window.open('', '_blank', 'width=400,height=600');
                printWin.document.write(result.printWindow);
                printWin.document.close(); // Important for some browsers to trigger load
                // The server's printer.js usually includes a script to auto-print, 
                // but if not, the user can press Ctrl+P in the popup.
            }

            // B. Visual Feedback
            alert(`Trade Accepted!\nChange: $${result.change.toFixed(2)}`);
            
            // C. Reset for next student
            voucherInput.value = '';
            document.querySelectorAll('.trade-item').forEach(el => el.classList.remove('active'));
            selectedItem = null;
            document.getElementById('tradeButton').disabled = true;
            document.getElementById('totalCostDisplay').innerText = "0";
            document.getElementById('cartPreview').innerHTML = ""; // Clear icon
            
        } else {
            // Handle specific errors (like Insufficient Funds)
            alert(`Trade Refused: ${result.error || "Unknown Error"}`);
            // Optional: Play a "Villager No" sound here
        }
    } catch (e) {
        console.error(e);
        alert("Connection Error: The Villager is sleeping.");
    }
});

// Initialize
loadInventory();