package com.smartlaundromat.payment.service.provider;

import com.smartlaundromat.payment.config.PaymentConfig;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.reactive.function.client.WebClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class OrangeMoneyServiceTest {

    @Mock
    PaymentConfig paymentConfig;

    @Mock
    WebClient.Builder webClientBuilder;

    @InjectMocks
    OrangeMoneyService orangeMoneyService;

    @Test
    void shouldReturnProviderName() {
        // when / then
        assertThat(orangeMoneyService.getProviderName()).isEqualTo("ORANGE_MONEY");
    }

    @Test
    void shouldReturnConfiguredTrueWhenAllKeysAreSet() {
        // given
        PaymentConfig.OrangeConfig config = new PaymentConfig.OrangeConfig();
        config.setClientId("client-id");
        config.setClientSecret("client-secret");
        config.setMerchantKey("merchant-key");
        when(paymentConfig.getOrange()).thenReturn(config);

        // when / then
        assertThat(orangeMoneyService.isConfigured()).isTrue();
    }

    @Test
    void shouldReturnConfiguredFalseWhenClientIdIsMissing() {
        // given
        PaymentConfig.OrangeConfig config = new PaymentConfig.OrangeConfig();
        config.setClientId(null);
        config.setClientSecret("client-secret");
        config.setMerchantKey("merchant-key");
        when(paymentConfig.getOrange()).thenReturn(config);

        // when / then
        assertThat(orangeMoneyService.isConfigured()).isFalse();
    }

    @Test
    void shouldReturnConfiguredFalseWhenClientSecretIsMissing() {
        // given
        PaymentConfig.OrangeConfig config = new PaymentConfig.OrangeConfig();
        config.setClientId("client-id");
        config.setClientSecret(null);
        config.setMerchantKey("merchant-key");
        when(paymentConfig.getOrange()).thenReturn(config);

        // when / then
        assertThat(orangeMoneyService.isConfigured()).isFalse();
    }

    @Test
    void shouldReturnConfiguredFalseWhenMerchantKeyIsMissing() {
        // given
        PaymentConfig.OrangeConfig config = new PaymentConfig.OrangeConfig();
        config.setClientId("client-id");
        config.setClientSecret("client-secret");
        config.setMerchantKey(null);
        when(paymentConfig.getOrange()).thenReturn(config);

        // when / then
        assertThat(orangeMoneyService.isConfigured()).isFalse();
    }

    @ParameterizedTest
    @CsvSource({
            "237612345678, 237612345678",
            "0612345678,   237612345678",
            "612345678,    237612345678",
            "+237612345678, 237612345678",
    })
    void shouldFormatPhoneNumberCorrectly(String input, String expected) {
        // when
        String result = orangeMoneyService.formatPhoneNumber(input);

        // then
        assertThat(result).isEqualTo(expected);
    }

    @Test
    void shouldPassthroughUnrecognizedPhoneFormat() {
        // when
        String result = orangeMoneyService.formatPhoneNumber("12345");

        // then
        assertThat(result).isEqualTo("12345");
    }
}
