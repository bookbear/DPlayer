import DPlayer from './player';

class Comment {
    player: DPlayer;

    constructor(player: DPlayer) {
        this.player = player;

        this.player.template.commentButton.addEventListener('click', () => {
            this.toggleDanmaku();
        });
    }

    toggleDanmaku(): void {
        if (!this.player.danmaku) return;
        if (this.player.danmaku.showing) {
            this.player.danmaku.hide();
        } else {
            this.player.danmaku.show();
        }
        this.syncUI();
    }

    // ボタン表示と設定パネルのチェックボックスを同期する
    // setting.ts からも呼ばれる
    syncUI(): void {
        const showing = this.player.danmaku?.showing ?? true;

        if (showing) {
            this.player.template.commentButton.setAttribute('aria-label', this.player.tran('Hide danmaku'));
            this.player.template.commentButton.classList.remove('dplayer-danmaku-hidden');
        } else {
            this.player.template.commentButton.setAttribute('aria-label', this.player.tran('Show danmaku'));
            this.player.template.commentButton.classList.add('dplayer-danmaku-hidden');
        }

        // 設定パネルのトグルに反映
        this.player.template.showDanmakuToggle.checked = showing;
        this.player.user.set('danmaku', showing ? 1 : 0);
    }
}

export default Comment;
