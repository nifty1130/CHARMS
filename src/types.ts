export type Role = 'camera' | 'host' | 'monitor' | 'controller' | 'admin'

export interface NodeInfo {
  id: string
  role: Role
  name: string
}

export type CHARMSMessage =
  | { type: 'register';          role: Role; name?: string }
  | { type: 'registered';        id: string }
  | { type: 'node_list';         nodes: NodeInfo[] }
  | { type: 'node_disconnected'; id: string }
  | { type: 'routing_state';     routes: Array<{ monitorId: string; sourceId: string }> }
  | { type: 'rename';            id: string; name: string }
  | { type: 'switch';            cameraId: string; monitorId: string }
  | { type: 'make_offer';        targetId: string }
  | { type: 'offer';             fromId: string; toId: string; sdp: RTCSessionDescriptionInit; candidates: RTCIceCandidateInit[] }
  | { type: 'answer';            fromId: string; toId: string; sdp: RTCSessionDescriptionInit; candidates: RTCIceCandidateInit[] }
  | { type: 'disconnect_from';   targetId: string }
  | { type: 'admin_state';       fromId: string; toId: string; title: string; subtitle: string }
