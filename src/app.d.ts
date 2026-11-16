// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	/**
	 * ファイルの保存先を選ぶ画面（File System Access API）
	 *
	 * PC の Chrome / Edge だけが対応している。TypeScript の標準の型定義にはまだ入っていないので、
	 * 録画で使う範囲だけをここで宣言する。
	 */
	interface SaveFilePickerOptions {
		suggestedName?: string;
		types?: { description?: string; accept: Record<`${string}/${string}`, `.${string}`[]> }[];
	}

	interface Window {
		showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
	}
}

export {};
