import * as DPlayerType from './types';
/**
 * SRT 字幕テキストを DPlayer の Dan[] 形式に変換する
 *
 * @param srtText - SRT フォーマットの字幕テキスト
 * @param color   - 弾幕の色 (デフォルト: '#ffffff')
 * @param type    - 弾幕の種類 'right' | 'top' | 'bottom' (デフォルト: 'right')
 */
export declare function parseSRT(srtText: string, color?: string, type?: DPlayerType.DanmakuType): DPlayerType.Dan[];
/**
 * ASS/SSA 字幕テキストを DPlayer の Dan[] 形式に変換する
 *
 * @param assText - ASS/SSA フォーマットの字幕テキスト
 * @param type    - 弾幕の種類 'right' | 'top' | 'bottom' (デフォルト: 'right')
 */
export declare function parseASS(assText: string, type?: DPlayerType.DanmakuType): DPlayerType.Dan[];
/**
 * WebVTT 字幕テキストを DPlayer の Dan[] 形式に変換する
 *
 * @param vttText - WebVTT フォーマットの字幕テキスト
 * @param color   - 弾幕の色 (デフォルト: '#ffffff')
 * @param type    - 弾幕の種類 'right' | 'top' | 'bottom' (デフォルト: 'right')
 */
export declare function parseVTT(vttText: string, color?: string, type?: DPlayerType.DanmakuType): DPlayerType.Dan[];
//# sourceMappingURL=subtitle-danmaku.d.ts.map