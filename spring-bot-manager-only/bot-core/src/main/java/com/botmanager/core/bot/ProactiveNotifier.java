package com.botmanager.core.bot;

import java.util.Map;

/**
 * Implemented by bots that can push a WhatsApp message to a customer outside of
 * any inbound conversation — e.g. MachineStateService/PaymentManagementService
 * telling a customer their cycle is almost done, or prompting for feedback once
 * a cycle completes. Unlike {@link BaseBot#sendMessage}, the message text is
 * resolved from the bot's own translation catalog and the customer's last-known
 * language, so callers only need to supply a message key and its parameters.
 */
public interface ProactiveNotifier {

    /**
     * @param phone      customer's WhatsApp number, in the same format used for inbound messages
     * @param messageKey a key in the bot's translation catalog
     * @param params     template variables for the message, or {@code null}/empty if none
     */
    void sendProactiveNotification(String phone, String messageKey, Map<String, Object> params);
}
