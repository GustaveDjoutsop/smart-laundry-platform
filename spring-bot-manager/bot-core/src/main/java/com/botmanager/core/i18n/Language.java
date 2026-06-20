package com.botmanager.core.i18n;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.Getter;

@Getter
public enum Language {

    EN("en"),
    FR("fr");

    private final String code;

    Language(String code) {
        this.code = code;
    }

    @JsonValue
    public String getCode() {
        return code;
    }

    @JsonCreator
    public static Language fromCode(String code) {
        if (code == null) {
            return EN;
        }

        for (Language lang : values()) {
            if (lang.code.equalsIgnoreCase(code)) {
                return lang;
            }
        }

        return EN;
    }

}
