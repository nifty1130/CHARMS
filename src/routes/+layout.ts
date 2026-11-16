// サーバーを持たないアプリなので、すべてブラウザの中で動かす。
// 各ページは静的な HTML として書き出し、オフラインでも開けるようにする。
export const ssr = false;
export const prerender = true;
export const trailingSlash = 'always';
