const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'orders.json');

let mongoCollection = null;
let mongoClient = null;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('.')); // Serve static files

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

function readOrdersFile() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeOrdersFile(orders) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2), 'utf8');
}

function nextId(orders) {
  if (!orders.length) return 1;
  return Math.max(...orders.map((o) => Number(o.id))) + 1;
}

function stripMongoId(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const { _id, ...rest } = doc;
  return rest;
}

async function initMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return;
  const { MongoClient } = require('mongodb');
  mongoClient = new MongoClient(uri);
  await mongoClient.connect();
  mongoCollection = mongoClient.db(process.env.MONGODB_DB || 'fuel_app').collection('orders');
  await mongoCollection.createIndex({ id: 1 }, { unique: true });
  console.log('Using MongoDB for order storage (online)');
}

async function getOrdersList() {
  if (mongoCollection) {
    const docs = await mongoCollection.find({}).toArray();
    return docs.map(stripMongoId);
  }
  return readOrdersFile();
}

// Routes
app.get('/orders', async (req, res) => {
  try {
    const list = await getOrdersList();
    res.json(list.sort((a, b) => Number(b.id) - Number(a.id)));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/orders', async (req, res) => {
  try {
    const { date, name, phone, zone, truck, rider, fuel, price, liters, status, notes } = req.body;
    let id;
    if (mongoCollection) {
      const all = await getOrdersList();
      id = nextId(all);
      await mongoCollection.insertOne({
        id,
        date,
        name,
        phone,
        zone,
        truck,
        rider,
        fuel,
        price,
        liters,
        status,
        notes,
      });
    } else {
      const orders = readOrdersFile();
      id = nextId(orders);
      orders.push({
        id,
        date,
        name,
        phone,
        zone,
        truck,
        rider,
        fuel,
        price,
        liters,
        status,
        notes,
      });
      writeOrdersFile(orders);
    }
    res.json({ id });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put('/orders/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { date, name, phone, zone, truck, rider, fuel, price, liters, status, notes } = req.body;
    if (mongoCollection) {
      const r = await mongoCollection.replaceOne(
        { id },
        {
          id,
          date,
          name,
          phone,
          zone,
          truck,
          rider,
          fuel,
          price,
          liters,
          status,
          notes,
        }
      );
      if (r.matchedCount === 0) {
        return res.status(404).json({ error: 'Order not found' });
      }
    } else {
      const orders = readOrdersFile();
      const idx = orders.findIndex((o) => Number(o.id) === id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Order not found' });
      }
      orders[idx] = {
        id,
        date,
        name,
        phone,
        zone,
        truck,
        rider,
        fuel,
        price,
        liters,
        status,
        notes,
      };
      writeOrdersFile(orders);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete('/orders/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (mongoCollection) {
      await mongoCollection.deleteOne({ id });
    } else {
      const orders = readOrdersFile().filter((o) => Number(o.id) !== id);
      writeOrdersFile(orders);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

const host = process.env.HOST || '0.0.0.0';

initMongo()
  .then(() => {
    app.listen(port, host, () => {
      const backend = mongoCollection ? 'MongoDB' : `file (${path.basename(DATA_FILE)})`;
      console.log(`Server on port ${port} — storage: ${backend}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
