import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";

/**
 * The throwaway funding key. Generated here, stored here (IndexedDB, this origin), never sent anywhere. Funds land on its
 * address; it signs the zkAPI vault deposit and, later, a withdrawal. Losing this browser's storage loses the key, which is
 * why /wallet exports it, encrypted, together with the zkAPI note.
 */
const DB = "zipcoin-chat-v1";
const STORE = "keys";
const KEY = "throwaway";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const done = (t: IDBTransaction) => new Promise<void>((res, rej) => ((t.oncomplete = () => res()), (t.onerror = () => rej(t.error)), (t.onabort = () => rej(t.error))));
const result = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

export async function loadKey(): Promise<Hex | null> {
  const db = await open();
  const t = db.transaction(STORE, "readonly");
  const v = (await result(t.objectStore(STORE).get(KEY))) as Hex | undefined;
  await done(t);
  return v ?? null;
}

export async function saveKey(pk: Hex) {
  const db = await open();
  const t = db.transaction(STORE, "readwrite");
  t.objectStore(STORE).put(pk, KEY);
  await done(t);
}

/** The key, created on first use. */
export async function ensureAccount(): Promise<PrivateKeyAccount> {
  let pk = await loadKey();
  if (!pk) {
    pk = generatePrivateKey();
    await saveKey(pk);
    await navigator.storage?.persist?.().catch(() => false);
  }
  return privateKeyToAccount(pk);
}

// ---- backup: throwaway key + the zkAPI browser wallet, encrypted with a passphrase -------------------------------------

const ZKAPI_DB = "zkapi-browser-wallet-v1";

function openExisting(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    let created = false;
    req.onupgradeneeded = () => {
      created = true;
    };
    req.onsuccess = () => {
      if (created) {
        req.result.close();
        indexedDB.deleteDatabase(name);
        resolve(null);
      } else resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

type Dump = Record<string, { key: IDBValidKey; value: unknown }[]>;

async function dumpDb(name: string): Promise<{ version: number; stores: Dump } | null> {
  const db = await openExisting(name);
  if (!db) return null;
  const stores: Dump = {};
  const names = [...db.objectStoreNames];
  if (!names.length) return { version: db.version, stores };
  const t = db.transaction(names, "readonly");
  for (const n of names) {
    const s = t.objectStore(n);
    const [keys, values] = await Promise.all([result(s.getAllKeys()), result(s.getAll())]);
    stores[n] = keys.map((key, i) => ({ key, value: values[i] }));
  }
  await done(t);
  db.close();
  return { version: db.version, stores };
}

async function restoreDb(name: string, dump: { version: number; stores: Dump }) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, dump.version);
    req.onupgradeneeded = () => {
      for (const n of Object.keys(dump.stores)) if (!req.result.objectStoreNames.contains(n)) req.result.createObjectStore(n);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const names = Object.keys(dump.stores).filter((n) => db.objectStoreNames.contains(n));
  if (names.length) {
    const t = db.transaction(names, "readwrite");
    for (const n of names) {
      const s = t.objectStore(n);
      s.clear();
      for (const { key, value } of dump.stores[n]) s.put(value, s.keyPath ? undefined : key);
    }
    await done(t);
  }
  db.close();
}

export type Backup = { v: 1; createdAt: number; throwaway: Hex; zkapi: { version: number; stores: Dump } | null };

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as BufferSource, iterations: 600_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Everything a chat needs to survive a lost browser, as one encrypted JSON file. */
export async function exportBackup(passphrase: string): Promise<string> {
  const pk = await loadKey();
  if (!pk) throw new Error("no throwaway key yet");
  const payload: Backup = { v: 1, createdAt: Date.now(), throwaway: pk, zkapi: await dumpDb(ZKAPI_DB) };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, enc.encode(JSON.stringify(payload, (_, v) => (typeof v === "bigint" ? `${v}n` : v)))));
  return JSON.stringify({ zipcoinChatBackup: 1, kdf: "pbkdf2-sha256-600k", salt: b64(salt), iv: b64(iv), data: b64(ct) });
}

export async function importBackup(file: string, passphrase: string): Promise<Backup> {
  const j = JSON.parse(file) as { zipcoinChatBackup: number; salt: string; iv: string; data: string };
  if (j.zipcoinChatBackup !== 1) throw new Error("not a zipcoin chat backup");
  const key = await deriveKey(passphrase, unb64(j.salt));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(j.iv) as BufferSource }, key, unb64(j.data) as BufferSource).catch(() => {
    throw new Error("wrong passphrase");
  });
  const backup = JSON.parse(dec.decode(pt), (_, v) => (typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)) as Backup;
  if (!/^0x[0-9a-fA-F]{64}$/.test(backup.throwaway)) throw new Error("backup has no key");
  await saveKey(backup.throwaway);
  if (backup.zkapi) await restoreDb(ZKAPI_DB, backup.zkapi);
  return backup;
}
