import bs58 from 'bs58'
import { Doctype } from "@ceramicnetwork/common"
import type { ParsedDID, DIDResolver, DIDDocument } from 'did-resolver'
import LegacyResolver from './legacyResolver'
import DocID from '@ceramicnetwork/docid'
import CID from 'cids'

interface Ceramic {
  loadDocument(docId: DocID): Promise<Doctype>;
  createDocument(type: string, content: any, opts: any): Promise<Doctype>;
}

interface ResolverRegistry {
  [index: string]: DIDResolver;
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function wrapDocument(content: any, did: string): DIDDocument {
  if (!(content && content.publicKeys)) throw new Error('Not a valid 3ID')
  const startDoc: DIDDocument = {
    '@context': 'https://w3id.org/did/v1',
    id: did,
    publicKey: [],
    authentication: [],
    keyAgreement: []
  }
  const doc = Object.entries(content.publicKeys as string[]).reduce((diddoc, [keyName, keyValue]) => {
    if (keyValue.startsWith('z')) { // we got a multicodec encoded key
      const keyBuf = bs58.decode(keyValue.slice(1))
      if (keyBuf[0] === 0xe7) { // it's secp256k1
        diddoc.publicKey.push({
          id: `${did}#${keyName}`,
          type: 'Secp256k1VerificationKey2018',
          controller: did,
          // remove multicodec varint and encode to hex
          publicKeyHex: keyBuf.slice(2).toString('hex')
        })
        diddoc.authentication.push({
          type: 'Secp256k1SignatureAuthentication2018',
          publicKey: `${did}#${keyName}`,
        })
      } else if (keyBuf[0] === 0xec) { // it's x25519
        // old key format, likely not needed in the future
        diddoc.publicKey.push({
          id: `${did}#${keyName}`,
          type: 'Curve25519EncryptionPublicKey',
          controller: did,
          publicKeyBase64: keyBuf.slice(2).toString('base64')
        })
        // new keyAgreement format for x25519 keys
        diddoc.keyAgreement.push({
          id: `${did}#${keyName}`,
          type: 'X25519KeyAgreementKey2019',
          controller: did,
          publicKeyBase58: bs58.encode(keyBuf.slice(2))
        })
      }
    } else { // we need to be backwards compatible (until js-did is used everywhere)
      if(keyName === 'signing') {
        diddoc.publicKey.push({
          id: `${did}#${keyName}`,
          type: 'Secp256k1VerificationKey2018',
          controller: did,
          // remove multicodec varint and encode to hex
          publicKeyHex: keyValue
        })
        diddoc.authentication.push({
          type: 'Secp256k1SignatureAuthentication2018',
          publicKey: `${did}#${keyName}`,
        })
      } else if (keyName === 'encryption') {
        diddoc.publicKey.push({
          id: `${did}#${keyName}`,
          type: 'Curve25519EncryptionPublicKey',
          controller: did,
          publicKeyBase64: keyValue
        })
      }
    }
    return diddoc
  }, startDoc)

  if (content.idx != null) {
    doc.service = [
      {
        id: `${did}#idx`,
        type: 'IdentityIndexRoot',
        serviceEndpoint: content.idx,
      },
    ]
  }

  return doc
}

const isLegacyDid = (didId: string): boolean => {
  try {
    new CID(didId) 
    return true
  } catch(e) {
    return false
  }
}

const getVersion = (query = ''): string | null => {
  const versionParam = query.split('&').find(e => e.includes('version-id'))
  return versionParam ? versionParam.split('=')[1] : null
}
 
const legacyResolve = async (ceramic: Ceramic, didId: string, version?: string): Promise<DIDDocument | null> => {
  // todo could add opt to pass ceramic ipfs here instead when true
  const legacyDoc = await LegacyResolver(didId)
  if (!legacyDoc) return null
  if (version === '0') return legacyDoc

  const keyEntry = legacyDoc.publicKey.findIndex(e => e.id.endsWith('managementKey'))
  const managementKey = legacyDoc.publicKey[keyEntry].ethereumAddress 
  if (!managementKey) return null

  try {
    const content =  { metadata: { controllers: [`did:key:${managementKey}`], tags: ['3id'] } }
    const doc = await ceramic.createDocument('tile', content, { applyOnly: true })
    const didDoc = await resolve(ceramic, doc.id.toString(), version)
    return didDoc
  } catch(e) {
    return legacyDoc
  }
}

const resolve = async (ceramic: Ceramic, didId: string, version?: string): Promise<DIDDocument | null> =>  {
  const docId = DocID.fromString(didId, version)
  const doctype = await ceramic.loadDocument(docId)
  return wrapDocument(doctype.content, `did:3:${didId}`)
}

export default {
  getResolver: (ceramic: Ceramic): ResolverRegistry => {
    return {
      '3': async (did: string, parsed: ParsedDID): Promise<DIDDocument | null> => {
        const version = getVersion(parsed.query)
        return isLegacyDid(parsed.id) ? legacyResolve(ceramic, parsed.id, version) : resolve(ceramic, parsed.id, version)
      }
    }
  }
}
