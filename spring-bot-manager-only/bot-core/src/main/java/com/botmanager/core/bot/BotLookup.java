package com.botmanager.core.bot;

import java.util.Optional;

public abstract class BotLookup {

    public abstract Optional<BaseBot> getBotByPhoneId(String phoneNumberId);

    public abstract Optional<BaseBot> getBotByName(String name);

    public abstract Optional<String> getBotNameByVerifyToken(String verifyToken);

}
