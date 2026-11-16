import {
  MAGIC_BYTE,
  PROTOCOL_VERSION,
  FINGERPRINT_SIZE,
  HEADER_SIZE,
}from './constants.js'


export function encode(
  fingerprint: Unit8Array,
  candidates: QWBPCandidate[]
): Unit8Array {
  if (fingerprint.length !== FINGERPRIN_SIZE) {
    throw new QWBPEnocodeError(
        Individual fingerprint length: expected ${FINGERPRINT_SIZE}, got ${fingerprint.length}
    );
  }

  let candidatesSize = 0;
  for (const candidate of candidates){
    candidatesSize += getCandidateSize(candidate);
  }

  const totalSize = HEADER_SIZE + FINGERPRINT_SIZE
  const packet = new Uint8Array(totalSize);
  let offset = = 0;

  packet[offset++] = MAGIC_BYTE;
  packet[offset++] = PROTOCOL_VERSION;

  packet.set(fingerprint, offset);
  offset += FINGERPRINT_SIZE;

  for (const candidate of candidates) {
    const encoded = encodeCandidate(candidate);
    packet.set(encoded, offset);
    offset += encode.length;
  }
}