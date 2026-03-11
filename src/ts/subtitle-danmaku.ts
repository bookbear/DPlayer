import * as DPlayerType from './types';

/**
 * SRT 字幕テキストを DPlayer の Dan[] 形式に変換する
 *
 * @param srtText - SRT フォーマットの字幕テキスト
 * @param color   - 弾幕の色 (デフォルト: '#ffffff')
 * @param type    - 弾幕の種類 'right' | 'top' | 'bottom' (デフォルト: 'right')
 */
export function parseSRT(
    srtText: string,
    color = '#ffffff',
    type: DPlayerType.DanmakuType = 'right',
): DPlayerType.Dan[] {
    const danList: DPlayerType.Dan[] = [];
    const blocks = srtText.trim().split(/\n\n+/);

    for (const block of blocks) {
        const lines = block.split('\n');

        // タイムスタンプ行を探す ("00:00:01,000 --> 00:00:04,000" or "00:01,000 --> ...")
        const timeLine = lines.find((l) => l.includes('-->'));
        if (!timeLine) continue;

        const match = timeLine.match(/(\d{1,2}:\d{2}(?::\d{2})?[,.\d]*)\s*-->/);
        if (!match) continue;

        const time = parseSRTTime(match[1]);

        // タイムスタンプ行より後をテキストとして取得
        const timeLineIndex = lines.indexOf(timeLine);
        const text = lines
            .slice(timeLineIndex + 1)
            .join('\n')
            .replace(/<[^>]+>/g, '')   // HTML タグ除去
            .replace(/\{[^}]+\}/g, '') // ASS タグ除去
            .trim();

        if (text) {
            danList.push({
                time,
                text,
                color,
                type,
                size: 'medium',
            });
        }
    }

    return danList;
}

function parseSRTTime(timeStr: string): number {
    // "HH:MM:SS,mmm" または "MM:SS,mmm" に対応
    const parts = timeStr.replace(',', '.').split(':');
    if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    } else {
        return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    }
}

// ---------------------------------------------------------------------------
// ASS / SSA パーサー
// ---------------------------------------------------------------------------

interface ASSStyle {
    primaryColor: string;
}

/**
 * ASS/SSA 字幕テキストを DPlayer の Dan[] 形式に変換する
 *
 * @param assText - ASS/SSA フォーマットの字幕テキスト
 * @param type    - 弾幕の種類 'right' | 'top' | 'bottom' (デフォルト: 'right')
 */
export function parseASS(
    assText: string,
    type: DPlayerType.DanmakuType = 'right',
): DPlayerType.Dan[] {
    const danList: DPlayerType.Dan[] = [];
    const lines = assText.split('\n');

    // スタイル定義を解析する
    const styles: Record<string, ASSStyle> = {};
    let styleFormatFields: string[] = [];
    let inStyleSection = false;

    // ダイアログ定義を解析する
    let dialogFormatFields: string[] = [];
    let inEventsSection = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (line.toLowerCase() === '[v4+ styles]' || line.toLowerCase() === '[v4 styles]') {
            inStyleSection = true;
            inEventsSection = false;
            continue;
        }
        if (line.toLowerCase() === '[events]') {
            inEventsSection = true;
            inStyleSection = false;
            continue;
        }
        if (line.startsWith('[') && line.endsWith(']')) {
            inStyleSection = false;
            inEventsSection = false;
            continue;
        }

        if (inStyleSection) {
            if (line.startsWith('Format:')) {
                styleFormatFields = line.replace('Format:', '').split(',').map((f) => f.trim());
            } else if (line.startsWith('Style:')) {
                const values = splitASSLine(line.replace('Style:', ''), styleFormatFields.length);
                const styleObj: Record<string, string> = {};
                styleFormatFields.forEach((field, i) => {
                    styleObj[field] = values[i] ?? '';
                });
                const name = styleObj['Name'] ?? 'Default';
                styles[name] = {
                    primaryColor: assColorToHex(styleObj['PrimaryColour'] ?? ''),
                };
            }
        }

        if (inEventsSection) {
            if (line.startsWith('Format:')) {
                dialogFormatFields = line.replace('Format:', '').split(',').map((f) => f.trim());
            } else if (line.startsWith('Dialogue:')) {
                const values = splitASSLine(line.replace('Dialogue:', ''), dialogFormatFields.length);
                const dialog: Record<string, string> = {};
                dialogFormatFields.forEach((field, i) => {
                    dialog[field] = values[i] ?? '';
                });

                const startStr = dialog['Start'];
                if (!startStr) continue;

                const time = parseASSTime(startStr);
                const styleName = dialog['Style'] ?? 'Default';
                const rawText = dialog['Text'] ?? '';

                // インライン上書き色 {\c&HBBGGRR&} を抽出
                const inlineColorMatch = rawText.match(/\{[^}]*\\c&H([0-9A-Fa-f]{6})&[^}]*\}/);
                let color: string;
                if (inlineColorMatch) {
                    color = assRGBToHex(inlineColorMatch[1]);
                } else {
                    color = styles[styleName]?.primaryColor ?? '#ffffff';
                }

                // ASS タグをすべて除去し、\N を改行に変換
                const text = rawText
                    .replace(/\{[^}]+\}/g, '')
                    .replace(/\\N/gi, '\n')
                    .replace(/\\n/gi, '\n')
                    .trim();

                if (text) {
                    danList.push({ time, text, color, type, size: 'medium' });
                }
            }
        }
    }

    return danList.sort((a, b) => a.time - b.time);
}

/** ASS の時刻文字列 "H:MM:SS.cc" を秒に変換する */
function parseASSTime(timeStr: string): number {
    const m = timeStr.trim().match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
    if (!m) return 0;
    return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 100;
}

/**
 * ASS の行を最大 maxFields 個の列に分割する。
 * 最後の列（テキスト）にはコンマが含まれる可能性があるため、
 * maxFields - 1 個のコンマで分割し残りを結合する。
 */
function splitASSLine(line: string, maxFields: number): string[] {
    const parts = line.split(',');
    if (maxFields <= 0 || parts.length <= maxFields) return parts.map((p) => p.trim());
    const head = parts.slice(0, maxFields - 1).map((p) => p.trim());
    const tail = parts.slice(maxFields - 1).join(',').trim();
    return [...head, tail];
}

/**
 * ASS カラー文字列 "&HAABBGGRR" または "AABBGGRR" を #RRGGBB に変換する。
 * ASS は BGR 順なので並び替えが必要。
 */
function assColorToHex(colorStr: string): string {
    const hex = colorStr.replace(/[^0-9A-Fa-f]/g, '');
    if (hex.length < 6) return '#ffffff';
    // AABBGGRR → 後ろ6文字が BBGGRR
    const bgr = hex.slice(-6);
    return assRGBToHex(bgr);
}

/** BGR 文字列 (6 hex chars) を #RRGGBB に変換する */
function assRGBToHex(bgr: string): string {
    const b = bgr.slice(0, 2);
    const g = bgr.slice(2, 4);
    const r = bgr.slice(4, 6);
    return `#${r}${g}${b}`;
}

// ---------------------------------------------------------------------------
// WebVTT パーサー
// ---------------------------------------------------------------------------

/**
 * WebVTT 字幕テキストを DPlayer の Dan[] 形式に変換する
 *
 * @param vttText - WebVTT フォーマットの字幕テキスト
 * @param color   - 弾幕の色 (デフォルト: '#ffffff')
 * @param type    - 弾幕の種類 'right' | 'top' | 'bottom' (デフォルト: 'right')
 */
export function parseVTT(
    vttText: string,
    color = '#ffffff',
    type: DPlayerType.DanmakuType = 'right',
): DPlayerType.Dan[] {
    // VTT は基本的に SRT と同じ構造（WEBVTT ヘッダーを除く）
    const body = vttText.replace(/^WEBVTT[^\n]*\n/, '').trim();
    return parseSRT(body, color, type);
}
