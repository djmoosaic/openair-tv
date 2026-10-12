package com.openairtv.app;

import android.content.Intent;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;

/**
 * Lets the web app hand a stream to Android's own video player (ExoPlayer),
 * which uses the device's hardware video decoder.
 */
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    @PluginMethod
    public void play(PluginCall call) {
        ArrayList<String> urls = new ArrayList<>();
        JSArray list = call.getArray("urls");
        if (list != null) {
            for (int i = 0; i < list.length(); i++) {
                String u = list.optString(i, null);
                if (u != null && !u.isEmpty()) urls.add(u);
            }
        }
        String single = call.getString("url");
        if (urls.isEmpty() && single != null && !single.isEmpty()) urls.add(single);
        if (urls.isEmpty()) {
            call.reject("No stream URL");
            return;
        }

        Intent intent = new Intent(getContext(), PlayerActivity.class);
        intent.putStringArrayListExtra(PlayerActivity.EXTRA_URLS, urls);
        intent.putExtra(PlayerActivity.EXTRA_TITLE, call.getString("title", ""));
        getActivity().startActivity(intent);
        call.resolve();
    }
}
