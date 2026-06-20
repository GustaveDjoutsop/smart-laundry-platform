package com.botmanager.core.persistence.converter;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

@Slf4j
@Component
@Converter
public class EncryptedStringConverter implements AttributeConverter<String, byte[]> {

    private static final String ALGORITHM = "AES/GCM/NoPadding";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH = 128;

    private final SecretKeySpec secretKey;
    private final SecureRandom secureRandom = new SecureRandom();

    public EncryptedStringConverter(@Value("${encryption.master-key:}") String masterKeyHex) {
        if (StringUtils.hasText(masterKeyHex) && masterKeyHex.length() == 64) {
            try {
                byte[] keyBytes = hexToBytes(masterKeyHex);
                secretKey = new SecretKeySpec(keyBytes, "AES");
            } catch (IllegalArgumentException exception) {
                throw new IllegalStateException("Invalid encryption master key; expected 64 hexadecimal characters.", exception);
            }
        } else {
            secretKey = null;
            log.warn("No encryption master key configured; bot secrets will be stored as plain text bytes.");
        }
    }

    @Override
    public byte[] convertToDatabaseColumn(String attribute) {
        if (attribute == null) {
            return null;
        }

        if (secretKey == null) {
            throw new IllegalStateException("No encryption master key configured; refusing to persist non-null bot secret.");
        }

        try {
            byte[] iv = new byte[GCM_IV_LENGTH];
            secureRandom.nextBytes(iv);

            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH, iv));

            byte[] encrypted = cipher.doFinal(attribute.getBytes(StandardCharsets.UTF_8));

            ByteBuffer buffer = ByteBuffer.allocate(iv.length + encrypted.length);
            buffer.put(iv);
            buffer.put(encrypted);

            return buffer.array();
        } catch (Exception exception) {
            throw new IllegalStateException("Failed to encrypt bot secret", exception);
        }
    }

    @Override
    public String convertToEntityAttribute(byte[] dbData) {
        if (dbData == null) {
            return null;
        }

        if (secretKey == null) {
            return new String(dbData, StandardCharsets.UTF_8);
        }

        try {
            ByteBuffer buffer = ByteBuffer.wrap(dbData);
            byte[] iv = new byte[GCM_IV_LENGTH];
            buffer.get(iv);
            byte[] encrypted = new byte[buffer.remaining()];
            buffer.get(encrypted);

            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH, iv));

            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (Exception exception) {
            throw new IllegalStateException("Failed to decrypt bot secret", exception);
        }
    }

    private static byte[] hexToBytes(String hex) {
        if (hex.length() % 2 != 0) {
            throw new IllegalArgumentException("Hex string must have an even length.");
        }

        byte[] data = new byte[hex.length() / 2];

        for (int index = 0; index < hex.length(); index += 2) {
            int high = Character.digit(hex.charAt(index), 16);
            int low = Character.digit(hex.charAt(index + 1), 16);

            if (high == -1 || low == -1) {
                throw new IllegalArgumentException("Invalid hexadecimal character in encryption master key.");
            }

            data[index / 2] = (byte) ((high << 4) + low);
        }

        return data;
    }
}