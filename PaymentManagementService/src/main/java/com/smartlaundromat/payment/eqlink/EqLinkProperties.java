package com.smartlaundromat.payment.eqlink;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * EQLink-related properties for the PaymentManagementService.
 *
 * <h2>Important: EQLink is NOT a payment system</h2>
 * EQLink is a machine CONTROL platform. Payments are handled by CamPay, MTN MoMo,
 * and Orange Money only. This class controls whether the service automatically
 * triggers a machine start via MachineStateService after a successful payment.
 *
 * <h2>Auto machine start</h2>
 * When {@code eqlink.auto-start-machine-after-payment=true}, the
 * {@link com.smartlaundromat.payment.service.machine.MachineStartService} is called
 * after any SUCCESSFUL payment to trigger MachineStateService to start the machine.
 * MachineStateService then decides whether to use EQLink IoT or MQTT for the actual
 * command dispatch.
 */
@Data
@Component
@ConfigurationProperties(prefix = "eqlink")
public class EqLinkProperties {

    /**
     * When {@code true}, the service automatically notifies MachineStateService
     * to start the machine after any payment is confirmed as SUCCESSFUL.
     * Default: {@code false}.
     */
    private boolean autoStartMachineAfterPayment = false;
}
