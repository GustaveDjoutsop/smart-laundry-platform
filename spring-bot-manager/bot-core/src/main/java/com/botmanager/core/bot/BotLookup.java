package com.botmanager.core.bot;

import java.util.Optional;

public interface BotLookup {

    Optional<BaseBot> getBotByPhoneId(String phoneNumberId);

    Optional<BaseBot> getBotByName(String name);

    Optional<String> getBotNameByVerifyToken(String verifyToken);

}
