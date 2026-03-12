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
            this.player.template.commentButton.setAttribute('aria-label', this.player.tran('Show danmaku'));
            this.player.template.commentButton.classList.add('dplayer-danmaku-hidden');
        } else {
            this.player.danmaku.show();
            this.player.template.commentButton.setAttribute('aria-label', this.player.tran('Hide danmaku'));
            this.player.template.commentButton.classList.remove('dplayer-danmaku-hidden');
        }
        this.player.user.set('danmaku', this.player.danmaku.showing ? 1 : 0);
    }
}

export default Comment;
