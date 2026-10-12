package com.openairtv.app;

import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;

import java.util.ArrayList;

/** Full-screen native player. Back (or the remote's Back button) returns to the channel list. */
@OptIn(markerClass = UnstableApi.class)
public class PlayerActivity extends AppCompatActivity {

    public static final String EXTRA_URLS = "urls";
    public static final String EXTRA_TITLE = "title";

    private ExoPlayer player;
    private PlayerView playerView;
    private TextView titleView;
    private ArrayList<String> urls = new ArrayList<>();
    private int index = 0;
    private boolean hasPlayed = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        ArrayList<String> extra = getIntent().getStringArrayListExtra(EXTRA_URLS);
        if (extra != null) urls = extra;
        String title = getIntent().getStringExtra(EXTRA_TITLE);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF000000);

        playerView = new PlayerView(this);
        playerView.setKeepContentOnPlayerReset(true);
        playerView.setControllerShowTimeoutMs(3000);
        root.addView(playerView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        titleView = new TextView(this);
        titleView.setText(title == null ? "" : title);
        titleView.setTextColor(0xFFFFFFFF);
        titleView.setTextSize(18);
        titleView.setShadowLayer(6f, 0f, 0f, 0xFF000000);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        titleView.setPadding(pad, pad, pad, pad);
        FrameLayout.LayoutParams tp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        tp.gravity = Gravity.TOP | Gravity.START;
        root.addView(titleView, tp);

        setContentView(root);
        hideSystemBars();

        if (urls.isEmpty()) {
            finish();
            return;
        }
        startPlayer();
    }

    private void startPlayer() {
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent("OpenAirTV/1.0 (Android)")
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(15000);

        player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(http))
                .build();
        playerView.setPlayer(player);

        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) {
                    hasPlayed = true;
                    titleView.postDelayed(() -> titleView.setVisibility(View.GONE), 4000);
                }
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                // Live streams sometimes fall behind; jump back to the live edge
                if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                    player.seekToDefaultPosition();
                    player.prepare();
                    return;
                }
                if (index + 1 < urls.size()) {
                    index++;
                    load();
                } else {
                    Toast.makeText(PlayerActivity.this,
                            "This stream isn't available right now. Try another channel.",
                            Toast.LENGTH_LONG).show();
                    finish();
                }
            }
        });

        load();
    }

    private void load() {
        String url = urls.get(index);
        MediaItem.Builder item = new MediaItem.Builder().setUri(url);
        String lower = url.toLowerCase();
        if (lower.contains(".m3u8") || !(lower.contains(".mp4") || lower.contains(".mpd") || lower.contains(".ts?") || lower.endsWith(".ts"))) {
            item.setMimeType(MimeTypes.APPLICATION_M3U8);
        }
        player.setMediaItem(item.build());
        player.setPlayWhenReady(true);
        player.prepare();
    }

    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        // Any remote button (except Back) shows the controls, like other TV apps
        if (event.getAction() == KeyEvent.ACTION_DOWN
                && event.getKeyCode() != KeyEvent.KEYCODE_BACK
                && playerView != null && !playerView.isControllerFullyVisible()) {
            playerView.showController();
            if (event.getKeyCode() == KeyEvent.KEYCODE_DPAD_CENTER
                    || event.getKeyCode() == KeyEvent.KEYCODE_ENTER) {
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Live TV: leaving the player stops it (no background audio)
        if (player != null) {
            player.release();
            player = null;
        }
        finish();
    }
}
