/**
 * IndexedDB access layer.
 *
 * Everything lives on the device. Progress photos are stored as Blobs in the
 * same database and never leave it (PRD §25) — there is no network write path
 * for them anywhere in this codebase. Meal photos are the one image type that
 * is sent out, and only to the vision proxy, only at the moment of logging.
 */

const DB_NAME = 'baseline';
const DB_VERSION = 1;

/** store name -> { keyPath, autoIncrement, indexes: [[name, keyPath, opts]] } */
const SCHEMA = {
  kv:           { keyPath: 'key' },
  weights:      { keyPath: 'id', indexes: [['date', 'date', { unique: true }]] },
  waists:       { keyPath: 'id', indexes: [['date', 'date', { unique: true }]] },
  foodEntries:  { keyPath: 'id', indexes: [['date', 'date']] },
  workouts:     { keyPath: 'id', indexes: [['date', 'date']] },
  dailyMetrics: { keyPath: 'date' },
  photos:       { keyPath: 'id', indexes: [['date', 'date']] },
  savedMeals:   { keyPath: 'id', indexes: [['name', 'name']] },
  corrections:  { keyPath: 'id', indexes: [['foodKey', 'foodKey']] },
  reviews:      { keyPath: 'weekStart' }
};

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(SCHEMA)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, {
          keyPath: def.keyPath,
          autoIncrement: !!def.autoIncrement
        });
        for (const [idxName, idxPath, opts] of def.indexes || []) {
          store.createIndex(idxName, idxPath, opts || {});
        }
      }

    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database upgrade blocked by another open tab.'));
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = fn(store);
    } catch (err) {
      tx.abort();
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  }));
}

const wrap = (req) => ({ __req: req });

export const db = {
  async getAll(store, query = null) {
    return run(store, 'readonly', (s) => wrap(s.getAll(query)));
  },

  async get(store, key) {
    return run(store, 'readonly', (s) => wrap(s.get(key)));
  },

  async put(store, value) {
    await run(store, 'readwrite', (s) => wrap(s.put(value)));
    return value;
  },

  async putMany(store, values) {
    await run(store, 'readwrite', (s) => {
      for (const v of values) s.put(v);
    });
    return values;
  },

  async remove(store, key) {
    return run(store, 'readwrite', (s) => wrap(s.delete(key)));
  },

  async clearStore(store) {
    return run(store, 'readwrite', (s) => wrap(s.clear()));
  },

  async byIndex(store, indexName, query) {
    return run(store, 'readonly', (s) => wrap(s.index(indexName).getAll(query)));
  },

  /** Full wipe — used by "Delete all my data" in Profile. */
  async destroyEverything() {
    const conn = await open();
    conn.close();
    dbPromise = null;
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  }
};

/** Small helper: monotonic-ish unique id that also sorts by creation time. */
export function newId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
