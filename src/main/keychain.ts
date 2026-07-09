import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

function dir() {
  return join(app.getPath('userData'), 'secrets')
}

function file(key: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) throw new Error('Invalid secret key')
  return join(dir(), `${key}.bin`)
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage is not available on this system.')
  }
  await fs.mkdir(dir(), { recursive: true, mode: 0o700 })
  const enc = safeStorage.encryptString(value)
  await fs.writeFile(file(key), enc, { mode: 0o600 })
}

export async function getSecret(key: string): Promise<string | null> {
  try {
    const enc = await fs.readFile(file(key))
    return safeStorage.decryptString(enc)
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
}

export async function deleteSecret(key: string): Promise<void> {
  try {
    await fs.unlink(file(key))
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err
  }
}
