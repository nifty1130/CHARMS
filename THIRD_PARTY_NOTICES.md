# 第三者の著作物について

## QWBP (QR-WebRTC Bootstrap Protocol)

`src/lib/rtc/` の QR シグナリングは、QWBP の設計（バイナリパケットの構造、
フィンガープリント比較による役割決定、確認コード）をもとにしています。

- リポジトリ: https://github.com/magarcia/qwbp
- 仕様書: https://magarcia.github.io/qwbp/spec.html

本家との違い: ICE の認証情報（ufrag / pwd）をフィンガープリントから導出せず、
ブラウザが生成した値をそのままパケットに同梱します（パケットのバージョン 1）。
ブラウザが作った SDP を書き換えないための変更で、本家 QWBP（バージョン 0）とは互換性がありません。

```
MIT License

Copyright (c) 2026 Martin Garcia Monterde

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
