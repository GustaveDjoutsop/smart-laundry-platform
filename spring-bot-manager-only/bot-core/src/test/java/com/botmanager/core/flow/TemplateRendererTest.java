package com.botmanager.core.flow;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class TemplateRendererTest {

    private TemplateRenderer templateRenderer;

    @BeforeEach
    void setUp() {
        templateRenderer = new TemplateRenderer();
    }

    @Test
    void shouldRenderSimpleVariable() {
        // given
        String template = "Hello {{name}}!";
        Map<String, Object> context = Map.of("name", "John");

        // when
        String result = templateRenderer.render(template, context);

        // then
        assertThat(result).isEqualTo("Hello John!");
    }

    @Test
    void shouldRenderMultipleVariables() {
        // given
        String template = "Machine: {{machineId}}, Program: {{programName}}, Amount: {{amount}} {{currency}}";
        Map<String, Object> context = Map.of(
                "machineId", "W1",
                "programName", "Quick Wash",
                "amount", 500,
                "currency", "XAF"
        );

        // when
        String result = templateRenderer.render(template, context);

        // then
        assertThat(result).isEqualTo("Machine: W1, Program: Quick Wash, Amount: 500 XAF");
    }

    @Test
    void shouldReturnEmptyStringForNullTemplate() {
        // when
        String result = templateRenderer.render(null, Map.of());

        // then
        assertThat(result).isEmpty();
    }

    @Test
    void shouldReturnEmptyStringForBlankTemplate() {
        // when
        String result = templateRenderer.render("   ", Map.of());

        // then
        assertThat(result).isEmpty();
    }

    @Test
    void shouldHandleMissingVariablesGracefully() {
        // given
        String template = "Hello {{name}}, your balance is {{balance}}";
        Map<String, Object> context = Map.of("name", "John");

        // when
        String result = templateRenderer.render(template, context);

        // then
        assertThat(result).isEqualTo("Hello John, your balance is ");
    }

}
