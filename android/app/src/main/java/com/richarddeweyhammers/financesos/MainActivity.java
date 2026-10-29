package com.richarddeweyhammers.financesos;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;

/**
 * The one Activity of the app: Capacitor's BridgeActivity hosting the
 * renderer's static export, plus a fix for how that export is laid out.
 *
 * Next.js writes every route as a folder with an index.html
 * (`/Overview/index.html`, see renderer/next.config.ts → trailingSlash), and
 * navigates between them client-side. Capacitor's asset server, however,
 * answers any extension-less path (`/Overview/`) with the ROOT index.html —
 * its single-page-app fallback — which is the "/" page, and that page redirects
 * to /Plan. Only a direct load hits this: the first launch (which IS "/"),
 * and a WebView restored after Android killed the app in the background, which
 * reloads the last URL. The WebViewClient below rewrites `/Route/` to
 * `/Route/index.html` when that file is in the bundle, so a restore comes back
 * on the page the user was on instead of the Plan.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    return super.shouldInterceptRequest(view, withIndexHtml(request));
                }
            }
        );
    }

    /** `/Route/` → `/Route/index.html` when the export has that page; anything else untouched. */
    private WebResourceRequest withIndexHtml(final WebResourceRequest request) {
        final Uri url = request.getUrl();
        if (url == null) return request;
        final String path = url.getPath();
        if (path == null || path.equals("/") || !path.endsWith("/")) return request;

        // Web assets are packaged under assets/public (Capacitor's layout).
        try (InputStream probe = getAssets().open("public" + path + "index.html")) {
            // Exists: fall through to the rewrite.
        } catch (IOException notAPage) {
            return request;
        }

        final Uri rewritten = url.buildUpon().path(path + "index.html").build();
        return new WebResourceRequest() {
            @Override
            public Uri getUrl() {
                return rewritten;
            }

            @Override
            public boolean isForMainFrame() {
                return request.isForMainFrame();
            }

            @Override
            public boolean isRedirect() {
                return request.isRedirect();
            }

            @Override
            public boolean hasGesture() {
                return request.hasGesture();
            }

            @Override
            public String getMethod() {
                return request.getMethod();
            }

            @Override
            public Map<String, String> getRequestHeaders() {
                return request.getRequestHeaders();
            }
        };
    }
}
