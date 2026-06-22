# CHARMsExEx 仕様書 v1.0

## 1. システム概要

### 目的
WebRTCを用いた映像共有・スイッチングシステム。インターネット接続・専用機材不要で、校内LANのみで映像切り替え・モニター配信・歌詞表示を実現する。

### CHARMSロール略称
| 略称 | ロール |
|---|---|
| **C** | Camera（映像入力） |
| **H** | Host（シグナリングハブ） |
| **A** | Admin（テロップ入力） |
| **R** | contRoller（スイッチャー） |
| **M** | Monitor（映像出力） |

### 設計原則
- **サーバーレス**: インターネット不使用。Node.jsサーバーは将来オプション
- **オフラインLAN専用**: STUN/TURNなし、校内有線LANのみ
- **マルチプラットフォーム**: Chrome/Edge・Safari対応（PWA）
- **低スペック端末対応**: Surface SE等でも動作

---

## 2. ロール定義

| ロール | ID | 上限 | 役割 |
|---|---|---|---|
| Host | `host` | 1台 | シグナリングハブ。全ノードへのDataChannel接続を保持。プレビュー表示 |
| Camera | `cam1`〜 | 上限未定※ | カメラ映像取得・送信 |
| Admin | `adm1`〜 | 上限未定※ | Canvas映像（歌詞・タイトル）。Camera実装と共通 |
| Monitor | `mon1`〜 | 上限未定※ | 映像受信・表示のみ |
| Controller | `ctrl1`〜 | 上限未定※ | 映像切り替え指示。全Camera・Adminのプレビュー表示 |

※ 上限は映像品質設定とCPU性能から算出（4章参照）。UIに推奨上限を表示する。

---

## 3. 接続トポロジー

### DataChannel接続（制御・シグナリングリレー）
```
Host ←─DataChannel─→ Camera×N
Host ←─DataChannel─→ Admin×N
Host ←─DataChannel─→ Monitor×M
Host ←─DataChannel─→ Controller×K
```

### 映像接続
```
Camera/Admin ──[映像＋音声（プレビュー）]──→ Host
Camera/Admin ──[映像＋音声（プレビュー）]──→ Controller×K  （K本同時送信）
Camera/Admin ──[映像＋音声（切替出力）]──→ Monitor          （1本、P2P直結）
```

---

## 4. 帯域・CPUによる上限計算（1GbE有線LAN）

### 映像ビットレート目安

| 品質 | 解像度 | FPS | 映像 | 音声 | 合計 |
|---|---|---|---|---|---|
| Low | 480p | 15 | 0.5 Mbps | 0.03 Mbps | **0.5 Mbps** |
| Medium | 720p | 30 | 2.5 Mbps | 0.13 Mbps | **2.6 Mbps** |
| High | 1080p | 30 | 5.0 Mbps | 0.13 Mbps | **5.1 Mbps** |

### ネットワーク帯域（N台Camera、K台Controller）

Camera 1台の送出ストリーム数：`Host(1) + Controller(K) + Monitor(0〜M) = K+1〜K+M+1本`
※帯域計算の代表値としてMonitor=1（切替中）を使用。Monitor=0（未割当）時はK+1本。

| 品質 | Camera1台の送出 | Controller1台の受信（N=8） | 総トラフィック（N=8,K=8） |
|---|---|---|---|
| Low (0.5M) | (K+2)×0.5 Mbps | 4 Mbps | **40 Mbps** |
| Medium (2.6M) | (K+2)×2.6 Mbps | 20 Mbps | **208 Mbps** |
| High (5.1M) | (K+2)×5.1 Mbps | 41 Mbps | **408 Mbps** |

1GbEスイッチ容量的には全品質で問題なし。

### CPU（実際のボトルネック）

WebRTCはPeerConnection毎に独立エンコード。Surface SE（Celeron N4020）でVP8ソフトウェアエンコードの場合：

| 品質 | Camera1台から送れる推奨宛先数 |
|---|---|
| Low (480p/15fps) | 〜10台（余裕） |
| Medium (720p/30fps) | 〜4台（Host+2Controller+1Monitor） |
| High (1080p/30fps) | 〜2台（Host+1Monitorのみ） |

→ **起動時に品質を選択させ、推奨最大Controller台数をUIに表示する。**

### DataChannelオーバーヘッド

| 内容 | 帯域 |
|---|---|
| 定常状態（状態通知等） | 〜50 Kbps（全ノード合計） |
| 接続時シグナリング（SDP/ICE） | 〜12 KB/接続（一時的） |

映像帯域に対して無視できるレベル。