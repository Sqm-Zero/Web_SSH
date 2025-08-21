package com.kklsqm.webssh.controller;

import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.JSchException;
import com.kklsqm.webssh.common.SSHConnectionManager;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 功能:
 * 作者: 沙琪马
 * 日期: 2025/8/19 19:52
 */
@Slf4j
@Controller
@RestController
public class SSHStompController {

    @Resource
    private SSHConnectionManager connectionManager;

    @Resource
    private SimpMessagingTemplate messagingTemplate;

    private final Map<String, String> userConnections = new ConcurrentHashMap<>();

    /**
     * 建立SSH连接
     */
    @MessageMapping("/ssh/connect")   // 客户端发送到 /app/ssh/connect
    @SendToUser("/queue/reply")       // 回复发到 /user/queue/reply
    public Map<String, Object> connect(@Payload Map<String, Object> payload,
                                       Principal principal) {
        try {
            String host = (String) payload.get("host");
            int port = payload.get("port") != null ? (Integer) payload.get("port") : 22;
            String username = (String) payload.get("username");
            String password = (String) payload.get("password");

            String connectionId = connectionManager.createConnection(host, port, username, password);
            String sessionId = (principal != null) ? principal.getName() : UUID.randomUUID().toString();
            userConnections.put(sessionId, connectionId);

            ChannelShell channel = connectionManager.getChannel(connectionId);
            startSSHChannel(sessionId, channel);

            return Map.of("type", "connected", "message", "SSH连接建立成功");
        } catch (Exception e) {
            log.error("建立SSH连接失败", e);
            return Map.of("type", "error", "message", "连接失败: " + e.getMessage());
        }
    }

    /**
     * 执行命令
     */
    @MessageMapping("/ssh/command")
    public void command(@Payload Map<String, Object> payload, Principal principal) {
        String connectionId = userConnections.get(principal.getName());
        if (connectionId == null) return;

        String command = (String) payload.get("command");
        ChannelShell channel = connectionManager.getChannel(connectionId);

        if (channel != null && channel.isConnected()) {
            try {
                OutputStream out = channel.getOutputStream();
                out.write((command + "\n").getBytes());
                out.flush();
            } catch (IOException e) {
                log.error("发送SSH命令失败", e);
            }
        }
    }

    /**
     * 断开连接
     */
    @MessageMapping("/ssh/disconnect")
    public void disconnect(Principal principal) {
        String connectionId = userConnections.remove(principal.getName());
        if (connectionId != null) {
            connectionManager.closeConnection(connectionId);
            log.info("SSH连接断开: {}", principal.getName());
        }
    }

    @MessageMapping("/ssh/input")
    public void input(@Payload Map<String, Object> payload, Principal principal) {
        String connectionId = userConnections.get(principal.getName());
        if (connectionId == null) return;

        String inputData = (String) payload.get("data");
        ChannelShell channel = connectionManager.getChannel(connectionId);

        if (channel != null && channel.isConnected()) {
            try {
                OutputStream out = channel.getOutputStream();
                out.write(inputData.getBytes(StandardCharsets.UTF_8));
                out.flush();
            } catch (IOException e) {
                log.error("发送SSH输入失败", e);
            }
        }
    }

    /**
     * 异步监听SSH输出并推送到客户端
     */
    private void startSSHChannel(String username, ChannelShell channel) throws JSchException, IOException {
        channel.connect();
        InputStream in = channel.getInputStream();

        new Thread(() -> {
            byte[] buffer = new byte[4096];
            try {
                while (channel.isConnected()) {
                    int len = in.read(buffer);
                    if (len > 0) {
                        String output = new String(buffer, 0, len, StandardCharsets.UTF_8);
                        // 发送到单个用户队列 /user/queue/output
                        messagingTemplate.convertAndSendToUser(
                                username,
                                "/queue/output",
                                Map.of("type", "output", "data", output)
                        );
                    }
                }
            } catch (Exception e) {
                log.warn("SSH输出读取中断: {}", e.getMessage());
            }
        }, "SSH-Output-Reader-" + username).start();
    }

}
