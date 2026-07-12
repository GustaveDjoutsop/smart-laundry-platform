package com.botmanager;

import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.InputStream;

import static org.assertj.core.api.Assertions.assertThat;

class LogbackConfigTest {

    @Test
    void lokiAppenderShouldUseCorrectPushPathAndAuthElement() throws Exception {
        Document doc;
        try (InputStream in = getClass().getClassLoader().getResourceAsStream("logback-spring.xml")) {
            assertThat(in).as("logback-spring.xml must be on the classpath").isNotNull();
            doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(in);
        }

        NodeList httpNodes = doc.getElementsByTagName("http");
        assertThat(httpNodes.getLength()).as("Loki4jAppender <http> block").isEqualTo(1);
        Element http = (Element) httpNodes.item(0);

        String url = http.getElementsByTagName("url").item(0).getTextContent().trim();
        assertThat(url)
                .as("Loki's push API path is /loki/api/v1/push, not /loki/v1/push")
                .endsWith("/loki/api/v1/push");

        assertThat(http.getElementsByTagName("basicAuth").getLength())
                .as("JavaHttpSender has no 'basicAuth' property — Logback silently ignores it, so auth would never be sent")
                .isZero();
        assertThat(http.getElementsByTagName("auth").getLength())
                .as("JavaHttpSender's basic-auth property is named 'auth' (http.auth.username/password)")
                .isEqualTo(1);
    }
}
