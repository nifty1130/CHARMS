/**
 * ルーム（合言葉）の判断部分 — 状態を持たない関数だけを置く
 *
 * ルームは、QR コードの代わりに「接続情報の文字列」をインターネット経由で受け渡す場所。
 * ホストが合言葉（6桁の数字）でルームを開き、端末は合言葉を知っていれば参加を申し込める。
 * 受け渡すのは QR に入れるのと同じ文字列だけで、映像や操作の内容はここを通らない。
 */

/** 合言葉の形式（6桁の数字） */
export const ROOM_CODE_PATTERN = /^\d{6}$/;

/** ホストの鍵の形式（ホストの端末が作る乱数。ルームの持ち主であることの証明に使う） */
export const HOST_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** 接続情報の文字列（Base45）の形式と長さの上限 */
const PACKET_PATTERN = /^[0-9A-Z $%*+\-./:]{20,1200}$/;

/** ホストがいなくなってから、ほかの人が同じ合言葉を使えるようになるまでの時間 */
export const CLAIM_TTL_MS = 12 * 60 * 60 * 1000;

/** 1つのルームに同時につなげる端末の数（申し込み中のものを含む） */
export const MAX_NODES = 64;

/** 受け取るメッセージの長さの上限 */
export const MAX_MESSAGE_LENGTH = 4096;

export type RoomRole = 'host' | 'node';

/** ルームの持ち主の記録 */
export interface Claim {
	/** ホストの鍵のハッシュ */
	keyHash: string;
	/** 最後にホストがつながっていた時刻 */
	seenAt: number;
}

export type AdmitResult =
	| { ok: true; replaceHost: boolean }
	| { ok: false; reason: 'taken' | 'full' | 'bad_request' };

/**
 * つなぎに来た相手を受け入れるか決める
 *
 * - ホスト: 合言葉が空いているか、同じ鍵を持っていれば受け入れる
 *   （同じ鍵なら、再読み込みしたホストとみなして前の接続と入れ替える）
 * - 端末: 上限に達していなければ受け入れる（ホストがいなければ、来るまで待たせる）
 */
export function admit(input: {
	role: RoomRole;
	keyHash: string | null;
	claim: Claim | null;
	hostConnected: boolean;
	nodeCount: number;
	now: number;
}): AdmitResult {
	const { role, keyHash, claim, hostConnected, nodeCount, now } = input;

	if (role === 'node') {
		return nodeCount >= MAX_NODES ? { ok: false, reason: 'full' } : { ok: true, replaceHost: false };
	}

	if (!keyHash) return { ok: false, reason: 'bad_request' };
	const claimed = claim !== null && (hostConnected || now - claim.seenAt < CLAIM_TTL_MS);
	if (claimed && claim.keyHash !== keyHash) return { ok: false, reason: 'taken' };
	return { ok: true, replaceHost: hostConnected };
}

/** サーバーから届けるメッセージ */
export type RoomServerMessage =
	| { type: 'host'; present: boolean }
	| { type: 'join'; peer: string; packet: string }
	| { type: 'leave'; peer: string }
	| { type: 'answer'; packet: string }
	| { type: 'reject'; reason: string }
	| { type: 'error'; reason: string };

/** 届け先（ホスト、または特定の端末） */
export type Delivery = { to: 'host' } | { to: 'node'; peer: string };

/**
 * 届いたメッセージを、誰に何として届けるか決める
 *
 * - 端末 → `offer`（自分の接続情報）→ ホストへ `join`
 * - ホスト → `answer`（ホストの接続情報）→ その端末へ `answer`
 * - ホスト → `reject` → その端末へ `reject`
 *
 * @returns 届け先と内容。形式が違うメッセージは null（無視する）
 */
export function relay(
	from: { role: RoomRole; id: string },
	raw: string
): { delivery: Delivery; message: RoomServerMessage } | null {
	if (raw.length > MAX_MESSAGE_LENGTH) return null;

	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof data !== 'object' || data === null) return null;
	const { type, packet, peer, reason } = data as Record<string, unknown>;

	if (from.role === 'node') {
		if (type !== 'offer' || !isPacket(packet)) return null;
		return { delivery: { to: 'host' }, message: { type: 'join', peer: from.id, packet } };
	}

	if (typeof peer !== 'string' || peer.length > 64) return null;
	if (type === 'answer' && isPacket(packet)) {
		return { delivery: { to: 'node', peer }, message: { type: 'answer', packet } };
	}
	if (type === 'reject') {
		return {
			delivery: { to: 'node', peer },
			message: { type: 'reject', reason: typeof reason === 'string' ? reason.slice(0, 40) : 'rejected' }
		};
	}
	return null;
}

function isPacket(value: unknown): value is string {
	return typeof value === 'string' && PACKET_PATTERN.test(value);
}

/** 文字列の SHA-256 を16進数で返す */
export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
