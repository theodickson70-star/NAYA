package tz.naya.app;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Inapokea ujumbe wa Firebase (FCM) hata app ikiwa imefungwa.
 * Server ya NAYA inatuma "data messages" tu (hakuna "notification" block), ili simu yenyewe
 * iamue jinsi ya kulia: type=offer -> kengele ya sekunde 30, offer_cancel -> simamisha, notice -> arifa ya kawaida.
 */
public class NayaMessagingService extends FirebaseMessagingService {
    @Override
    public void onNewToken(@NonNull String token) {
        NayaAlerts.saveToken(this, token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String type = data.get("type");
        if ("offer".equals(type)) {
            NayaAlerts.showOffer(this, data, false, NayaAlerts.RING_MS);
        } else if ("offer_cancel".equals(type)) {
            NayaAlerts.cancelOffer(this, data.get("rideId"));
        } else {
            NayaAlerts.showNotice(this, data.get("title"), data.get("body"), data.get("tag"));
        }
    }
}
