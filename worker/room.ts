/**
 * Room — 合言葉1つぶんのルーム（Durable Object）
 *
 * ホストと端末が WebSocket でつながり、接続情報の文字列を受け渡す。
 * 判断の中身は room-logic.ts にあり、ここは WebSocket とのつなぎ役だけをする。
 *
 * 誰も話していない間はメモリから降ろされる（WebSocket Hibernation）。
 * そのため、状態は変数に持たず、WebSocket に付けた情報と保存領域から毎回読み直す。
 */

import { DurableObject } from 'cloudflare:workers';
import {
	admit,
	CLAIM_TTL_MS,
	HOST_KEY_PATTERN,
	relay,
	sha256Hex,
	type Claim,
	type RoomRole,
	type RoomServerMessage
} from './room-logic';

/** WebSocket に付けておく情報 */
interface Attachment {
	role: RoomRole;
	id: string;
}

/** 切断するときの番号（4000 番台はアプリが自由に使える） */
const CLOSE_REPLACED = 4000;
const CLOSE_REFUSED = 4001;

export class Room extends DurableObject<Record<string, unknown>> {
	constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
		super(ctx, env);
		// 接続を保つための ping には、Durable Object を起こさずに自動で返事をする
		this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
			return Response.json({ error: 'websocket_required' }, { status: 426 });
		}

		const url = new URL(request.url);
		const role: RoomRole = url.searchParams.get('as') === 'host' ? 'host' : 'node';
		const key = url.searchParams.get('key');
		const keyHash = role === 'host' && key && HOST_KEY_PATTERN.test(key) ? await sha256Hex(key) : null;

		const claim = (await this.ctx.storage.get<Claim>('claim')) ?? null;
		const hosts = this.ctx.getWebSockets('host');
		const result = admit({
			role,
			keyHash,
			claim,
			hostConnected: hosts.length > 0,
			nodeCount: this.ctx.getWebSockets('node').length,
			now: Date.now()
		});

		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];

		if (!result.ok) {
			// ブラウザの WebSocket は HTTP のエラー番号を読めないので、いったん受けてから理由を伝えて切る
			server.accept();
			server.send(JSON.stringify({ type: 'error', reason: result.reason } satisfies RoomServerMessage));
			server.close(CLOSE_REFUSED, result.reason);
			return new Response(null, { status: 101, webSocket: client });
		}

		const attachment: Attachment = { role, id: crypto.randomUUID() };
		this.ctx.acceptWebSocket(server, [role]);
		server.serializeAttachment(attachment);

		if (role === 'host') {
			// 同じ鍵のホストが来たら（再読み込みなど）、前の接続と入れ替える
			for (const old of hosts) old.close(CLOSE_REPLACED, 'replaced');
			await this.ctx.storage.put('claim', { keyHash: keyHash!, seenAt: Date.now() } satisfies Claim);
			await this.ctx.storage.deleteAlarm();
			this.#broadcast('node', { type: 'host', present: true });
		} else {
			this.#send(server, { type: 'host', present: hosts.length > 0 });
		}

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
		if (typeof data !== 'string') return;
		const from = ws.deserializeAttachment() as Attachment | null;
		if (!from) return;

		const routed = relay(from, data);
		if (!routed) return;

		if (routed.delivery.to === 'host') {
			const [host] = this.ctx.getWebSockets('host');
			if (host) this.#send(host, routed.message);
			else this.#send(ws, { type: 'host', present: false });
			return;
		}

		const peer = routed.delivery.peer;
		const target = this.ctx
			.getWebSockets('node')
			.find((socket) => (socket.deserializeAttachment() as Attachment | null)?.id === peer);
		if (target) this.#send(target, routed.message);
	}

	async webSocketClose(ws: WebSocket, code: number): Promise<void> {
		await this.#onGone(ws, code);
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		await this.#onGone(ws, 1011);
	}

	/** ホストがいなくなって時間が経ったら、合言葉をほかの人が使えるように記録を消す */
	async alarm(): Promise<void> {
		if (this.ctx.getWebSockets('host').length === 0) await this.ctx.storage.deleteAll();
	}

	async #onGone(ws: WebSocket, code: number): Promise<void> {
		const from = ws.deserializeAttachment() as Attachment | null;
		try {
			ws.close(code === 1005 || code === 1006 ? 1000 : code);
		} catch {
			// すでに閉じている
		}
		if (!from) return;

		if (from.role === 'node') {
			const [host] = this.ctx.getWebSockets('host');
			if (host) this.#send(host, { type: 'leave', peer: from.id });
			return;
		}

		// 入れ替えで閉じた古いホストの後始末では、何もしない（新しいホストがもういる）
		const others = this.ctx.getWebSockets('host').filter((socket) => socket !== ws);
		if (others.length > 0) return;

		const claim = await this.ctx.storage.get<Claim>('claim');
		if (claim) await this.ctx.storage.put('claim', { ...claim, seenAt: Date.now() } satisfies Claim);
		await this.ctx.storage.setAlarm(Date.now() + CLAIM_TTL_MS);
		this.#broadcast('node', { type: 'host', present: false });
	}

	#send(ws: WebSocket, message: RoomServerMessage): void {
		try {
			ws.send(JSON.stringify(message));
		} catch {
			// 相手がすでに切れている
		}
	}

	#broadcast(role: RoomRole, message: RoomServerMessage): void {
		for (const ws of this.ctx.getWebSockets(role)) this.#send(ws, message);
	}
}
