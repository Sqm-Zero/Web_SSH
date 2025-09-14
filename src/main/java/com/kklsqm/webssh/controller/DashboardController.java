package com.kklsqm.webssh.controller;

import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.Session;
import com.kklsqm.webssh.common.SSHConnectionManager;
import com.kklsqm.webssh.domain.SshService;
import com.kklsqm.webssh.service.SshServiceService;
import jakarta.annotation.Resource;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 功能: 服务器仪表盘
 * 作者: 沙琪马
 * 日期: 2025/9/1 11:50
 */
@Slf4j
@RestController
@RequestMapping("/api/dashboard")
@RequiredArgsConstructor
public class DashboardController {

    private final SshServiceService serverService; // 用于获取服务器信息

    private final SSHConnectionManager connectionManager; // 重用现有的 SSH 连接管理器

    // 可选：用于缓存历史数据，避免频繁执行命令
    private final Map<Long, List<Map<String, Object>>> historyCache = new ConcurrentHashMap<>();
    private final Map<Long, Long> lastFetchTime = new ConcurrentHashMap<>();
    private static final long CACHE_DURATION_MS = 5 * 60 * 1000; // 5分钟缓存

    /**
     * 获取服务器性能指标 (CPU, Memory, Disk)
     * @param serverId 服务器ID
     * @return 包含指标的 ResponseEntity
     */
    @GetMapping("/server/{serverId}/metrics")
    public ResponseEntity<Map<String, Object>> getServerMetrics(@PathVariable Long serverId) {
        log.info("获取服务器 {} 性能指标", serverId);
        Map<String, Object> response = new HashMap<>();
        try {
            SshService server = Optional.ofNullable(serverService.getById(serverId))
                    .orElseThrow(() -> new RuntimeException("服务器未找到"));

            // 通过 SSH 连接管理器创建临时连接来执行命令
            String connectionId = connectionManager.createConnection(
                    server.getHost(), server.getPort(), server.getUsername(), server.getPassword()
            );

            try {
                Session session = connectionManager.getSession(connectionId);
                if (session == null || !session.isConnected()) {
                    throw new JSchException("无法建立或获取有效的SSH会话");
                }

                Map<String, Double> metrics = new HashMap<>();

                // 并行执行命令以提高效率
                CompletableFuture<Double> cpuFuture = CompletableFuture.supplyAsync(() -> {
                    try {
                        return executeCommandForValue(session, "vmstat 1 2 | tail -1 | awk '{print 100-$15}'");
                    } catch (Exception e) {
                        log.warn("获取CPU使用率失败: {}", e.getMessage());
                        return -1.0; // 用-1表示获取失败
                    }
                });

                CompletableFuture<Double> memFuture = CompletableFuture.supplyAsync(() -> {
                    try {
                        // 使用 free 命令计算内存使用率
                        return executeCommandForValue(session, "free | awk 'NR==2{printf \"%.2f\", $3*100/$2 }'");
                    } catch (Exception e) {
                        log.warn("获取内存使用率失败: {}", e.getMessage());
                        return -1.0;
                    }
                });

                CompletableFuture<Double> diskFuture = CompletableFuture.supplyAsync(() -> {
                    try {
                        // 获取根分区使用率
                        return executeCommandForValue(session, "df -h / | awk 'NR==2{print $5}' | sed 's/%//'");
                    } catch (Exception e) {
                        log.warn("获取磁盘使用率失败: {}", e.getMessage());
                        return -1.0;
                    }
                });

                // 等待所有命令执行完成
                CompletableFuture.allOf(cpuFuture, memFuture, diskFuture).join();

                metrics.put("cpu", cpuFuture.get());
                metrics.put("memory", memFuture.get());
                metrics.put("disk", diskFuture.get());

                response.put("success", true);
                response.put("data", metrics);

            } finally {
                // 确保临时连接被关闭
                connectionManager.closeConnection(connectionId);
            }

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("获取服务器 {} 指标失败", serverId, e);
            response.put("success", false);
            response.put("message", "获取指标失败: " + e.getMessage());
            return ResponseEntity.status(500).body(response);
        }
    }

    /**
     * 获取特定服务的状态 (MySQL, Redis, Docker)
     * @param serverId 服务器ID
     * @return 包含服务状态的 ResponseEntity
     */
    @GetMapping("/server/{serverId}/services")
    public ResponseEntity<Map<String, Object>> getServiceStatus(@PathVariable Long serverId) {
        Map<String, Object> response = new HashMap<>();
        try {
            SshService server = serverService.getById(serverId);
            if (server == null) {
                response.put("success", false);
                response.put("message", "服务器未找到");
                return ResponseEntity.ok(response);
            }

            String connectionId = connectionManager.createConnection(
                    server.getHost(), server.getPort(), server.getUsername(), server.getPassword()
            );

            try {
                Session session = Optional.ofNullable(connectionManager.getSession(connectionId))
                        .orElseThrow(() -> new RuntimeException("无法建立或获取有效的SSH会话"));

                Map<String, String> services = new HashMap<>();
                // 定义要检查的服务及其对应的systemctl命令
                Map<String, String> serviceCommands = Map.of(
                        "mysql", "systemctl is-active mysql",
                        "redis", "systemctl is-active redis",
                        "docker", "systemctl is-active docker"
                        // 可以根据实际服务名称调整命令，例如 mysqld, redis-server
                );

                // 并行检查服务状态
                List<CompletableFuture<Void>> futures = serviceCommands.entrySet().stream()
                        .map(entry -> CompletableFuture.runAsync(() -> {
                            try {
                                String serviceName = entry.getKey();
                                String command = entry.getValue();
                                String status = executeSimpleCommand(session, command).trim().toLowerCase();
                                // 标准化输出，通常 'active' 表示运行，'inactive'/'failed' 表示停止
                                services.put(serviceName, status);
                            } catch (Exception e) {
                                log.warn("检查服务 {} 状态失败: {}", entry.getKey(), e.getMessage());
                                services.put(entry.getKey(), "unknown");
                            }
                        }))
                        .toList();

                // 等待所有服务检查完成
                CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();

                response.put("success", true);
                response.put("data", services);

            } finally {
                connectionManager.closeConnection(connectionId);
            }

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("获取服务器 {} 服务状态失败", serverId, e);
            response.put("success", false);
            response.put("message", "获取服务状态失败: " + e.getMessage());
            return ResponseEntity.status(500).body(response);
        }
    }

    /**
     * 获取 Docker 容器列表
     * @param serverId 服务器ID
     * @return 包含容器列表的 ResponseEntity
     */
    @GetMapping("/server/{serverId}/docker/containers")
    public ResponseEntity<Map<String, Object>> getDockerContainers(@PathVariable Long serverId) {
        Map<String, Object> response = new HashMap<>();
        try {
            SshService server = Optional.ofNullable(serverService.getById(serverId))
                    .orElseThrow(() -> new RuntimeException("服务器未找到"));

            String connectionId = connectionManager.createConnection(
                    server.getHost(), server.getPort(), server.getUsername(), server.getPassword()
            );

            try {
                Session session = Optional.ofNullable(connectionManager.getSession(connectionId))
                        .orElseThrow(() -> new RuntimeException("无法建立或获取有效的SSH会话"));

                List<Map<String, Object>> containers = new ArrayList<>();

                // 执行 docker ps -a --format 命令获取所有容器的详细信息
                // 使用 Go 模板格式化输出，方便解析
                String command = "docker ps -a --format \"{{.ID}}|{{.Names}}|{{.Status}}|{{.Ports}}|{{.Image}}\"";
                String output = executeSimpleCommand(session, command);

                if (output != null && !output.trim().isEmpty()) {
                    String[] lines = output.split("\n");
                    for (String line : lines) {
                        String[] parts = line.split("\\|");
                        if (parts.length >= 5) {
                            Map<String, Object> container = getStringObjectMap(parts);
                            containers.add(container);
                        }
                    }
                }

                response.put("success", true);
                response.put("data", containers);

            } finally {
                connectionManager.closeConnection(connectionId);
            }

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("获取服务器 {} Docker 容器列表失败", serverId, e);
            response.put("success", false);
            response.put("message", "获取 Docker 容器列表失败: " + e.getMessage());
            return ResponseEntity.status(500).body(response);
        }
    }

    private static Map<String, Object> getStringObjectMap(String[] parts) {
        Map<String, Object> container = new HashMap<>();
        container.put("id", parts[0].substring(0, Math.min(parts[0].length(), 12))); // 取短ID
        container.put("name", parts[1]);
        container.put("status", parts[2]);

        // 解析端口信息
        String portsRaw = parts[3];
        List<String> ports = new ArrayList<>();
        if (!portsRaw.isEmpty()) {
            // 简单处理，实际可能更复杂 (e.g., 8080/tcp, 0.0.0.0:80->80/tcp)
            // 这里直接存储原始字符串，前端可以进一步解析或显示
            ports.add(portsRaw);
        }
        container.put("ports", ports);

        container.put("image", parts[4]);
        // 简单判断是否运行中
        container.put("isRunning", parts[2].toLowerCase().contains("up"));
        return container;
    }

    /**
     * (可选) 获取服务器历史性能数据 (带缓存)
     * @param serverId 服务器ID
     * @return 包含历史数据的 ResponseEntity
     */
    @GetMapping("/server/{serverId}/history")
    public ResponseEntity<Map<String, Object>> getPerformanceHistory(@PathVariable Long serverId) {
        Map<String, Object> response = new HashMap<>();
        try {
            SshService server = Optional.ofNullable(serverService.getById(serverId))
                    .orElseThrow(() -> new RuntimeException("服务器未找到"));

            long now = System.currentTimeMillis();
            long lastTime = lastFetchTime.getOrDefault(serverId, 0L);

            // 检查缓存是否有效
            if (now - lastTime < CACHE_DURATION_MS && historyCache.containsKey(serverId)) {
                response.put("success", true);
                response.put("data", historyCache.get(serverId));
                response.put("cached", true);
                log.debug("从缓存返回服务器 {} 的历史数据", serverId);
                return ResponseEntity.ok(response);
            }

            String connectionId = connectionManager.createConnection(
                    server.getHost(), server.getPort(), server.getUsername(), server.getPassword()
            );

            try {
                Session session = Optional.ofNullable(connectionManager.getSession(connectionId))
                        .orElseThrow(() -> new JSchException("无法建立或获取有效的SSH会话"));

                List<Map<String, Object>> historyData = new ArrayList<>();
                // 模拟获取最近几次的数据点 (实际应用中可能需要从数据库或时序数据库查询)
                // 这里简化为获取当前数据并添加几个历史点
                for (int i = 4; i >= 0; i--) {
                    Map<String, Object> point = new HashMap<>();
                    point.put("timestamp", now - i * 60 * 1000); // 每分钟一个点

                    // 模拟数据，实际应调用 getServerMetrics 并存储结果
                    // 注意：真实场景下，您不应在此处再次执行SSH命令来获取历史数据，
                    // 而应将实时数据存储到数据库或内存队列中供查询。
                    // 此处仅为演示API结构。
                    point.put("cpu", 20.0 + (Math.random() * 30)); // 模拟CPU 20-50%
                    point.put("memory", 40.0 + (Math.random() * 20)); // 模拟内存 40-60%
                    point.put("disk", 50.0 + (Math.random() * 20)); // 模拟磁盘 50-70%
                    historyData.add(point);
                }

                // 更新缓存
                historyCache.put(serverId, historyData);
                lastFetchTime.put(serverId, now);

                response.put("success", true);
                response.put("data", historyData);
                response.put("cached", false);

            } finally {
                connectionManager.closeConnection(connectionId);
            }

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("获取服务器 {} 历史数据失败", serverId, e);
            response.put("success", false);
            response.put("message", "获取历史数据失败: " + e.getMessage());
            return ResponseEntity.status(500).body(response);
        }
    }

    /**
     * 获取服务器系统信息 (运行时间、负载、进程数等)
     * @param serverId 服务器ID
     * @return 包含系统信息的 ResponseEntity
     */
    @GetMapping("/server/{serverId}/system")
    public ResponseEntity<Map<String, Object>> getSystemInfo(@PathVariable Long serverId) {
        Map<String, Object> response = new HashMap<>();
        try {
            SshService server = Optional.ofNullable(serverService.getById(serverId))
                    .orElseThrow(() -> new RuntimeException("服务器未找到"));

            String connectionId = connectionManager.createConnection(
                    server.getHost(), server.getPort(), server.getUsername(), server.getPassword()
            );

            try {
                Session session = Optional.ofNullable(connectionManager.getSession(connectionId))
                        .orElseThrow(() -> new JSchException("无法建立或获取有效的SSH会话"));

                Map<String, Object> systemInfo = new HashMap<>();

                // 并行获取系统信息
                CompletableFuture<Long> uptimeFuture = CompletableFuture.supplyAsync(() -> {
                    try {
                        String uptimeStr = executeSimpleCommand(session, "cat /proc/uptime").trim();
                        String[] parts = uptimeStr.split("\\s+");
                        return (long) Double.parseDouble(parts[0]);
                    } catch (Exception e) {
                        log.warn("获取运行时间失败: {}", e.getMessage());
                        return 0L;
                    }
                });

                CompletableFuture<double[]> loadFuture = CompletableFuture.supplyAsync(() -> {
                    try {
                        String loadStr = executeSimpleCommand(session, "cat /proc/loadavg").trim();
                        String[] parts = loadStr.split("\\s+");
                        return new double[]{
                            Double.parseDouble(parts[0]), // 1分钟负载
                            Double.parseDouble(parts[1]), // 5分钟负载
                            Double.parseDouble(parts[2])  // 15分钟负载
                        };
                    } catch (Exception e) {
                        log.warn("获取负载信息失败: {}", e.getMessage());
                        return new double[]{0.0, 0.0, 0.0};
                    }
                });

                CompletableFuture<Integer> processFuture = CompletableFuture.supplyAsync(() -> {
                    try {
                        String processStr = executeSimpleCommand(session, "ps aux | wc -l").trim();
                        return Integer.parseInt(processStr) - 1; // 减去标题行
                    } catch (Exception e) {
                        log.warn("获取进程数失败: {}", e.getMessage());
                        return 0;
                    }
                });

                CompletableFuture<Integer> connectionFuture = CompletableFuture.supplyAsync(() -> {
                    try {
                        String connStr = executeSimpleCommand(session, "ss -tuln | wc -l").trim();
                        return Integer.parseInt(connStr) - 1; // 减去标题行
                    } catch (Exception e) {
                        log.warn("获取连接数失败: {}", e.getMessage());
                        return 0;
                    }
                });

                // 等待所有命令执行完成
                CompletableFuture.allOf(uptimeFuture, loadFuture, processFuture, connectionFuture).join();

                systemInfo.put("uptime", uptimeFuture.get());
                systemInfo.put("loadAverage", loadFuture.get());
                systemInfo.put("processCount", processFuture.get());
                systemInfo.put("connectionCount", connectionFuture.get());

                response.put("success", true);
                response.put("data", systemInfo);

            } finally {
                connectionManager.closeConnection(connectionId);
            }

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("获取服务器 {} 系统信息失败", serverId, e);
            response.put("success", false);
            response.put("message", "获取系统信息失败: " + e.getMessage());
            return ResponseEntity.status(500).body(response);
        }
    }

    /**
     * Docker 容器操作 (启动、停止、重启)
     * @param serverId 服务器ID
     * @param containerId 容器ID
     * @param action 操作类型 (start, stop, restart)
     * @return 操作结果
     */
    @PostMapping("/server/{serverId}/docker/container/{containerId}/{action}")
    public ResponseEntity<Map<String, Object>> containerAction(
            @PathVariable Long serverId,
            @PathVariable String containerId,
            @PathVariable String action) {
        
        Map<String, Object> response = new HashMap<>();
        
        // 验证操作类型
        if (!action.matches("start|stop|restart")) {
            response.put("success", false);
            response.put("message", "不支持的操作类型: " + action);
            return ResponseEntity.badRequest().body(response);
        }

        try {
            SshService server = Optional.ofNullable(serverService.getById(serverId))
                    .orElseThrow(() -> new RuntimeException("服务器未找到"));

            String connectionId = connectionManager.createConnection(
                    server.getHost(), server.getPort(), server.getUsername(), server.getPassword()
            );

            try {
                Session session = Optional.ofNullable(connectionManager.getSession(connectionId))
                        .orElseThrow(() -> new JSchException("无法建立或获取有效的SSH会话"));

                // 构建 Docker 命令
                String command = String.format("docker %s %s", action, containerId);
                String output = executeSimpleCommand(session, command);

                // 检查操作是否成功
                boolean success = true;
                String message = String.format("容器 %s 已%s", containerId.substring(0, Math.min(12, containerId.length())), action);

                // 对于某些操作，检查容器状态来确认是否成功
                if ("start".equals(action) || "restart".equals(action)) {
                    try {
                        String statusCmd = String.format("docker inspect --format='{{.State.Status}}' %s", containerId);
                        String status = executeSimpleCommand(session, statusCmd).trim();
                        if (!"running".equals(status)) {
                            success = false;
                            message = String.format("容器 %s %s 失败，当前状态: %s", 
                                containerId.substring(0, Math.min(12, containerId.length())), action, status);
                        }
                    } catch (Exception e) {
                        log.warn("检查容器状态失败: {}", e.getMessage());
                    }
                }

                response.put("success", success);
                response.put("message", message);
                response.put("output", output);

            } finally {
                connectionManager.closeConnection(connectionId);
            }

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("执行容器 {} 操作失败: {}", action, e.getMessage(), e);
            response.put("success", false);
            response.put("message", String.format("容器 %s 失败: %s", action, e.getMessage()));
            return ResponseEntity.status(500).body(response);
        }
    }

    /**
     * 获取 Docker 容器日志
     * @param serverId 服务器ID
     * @param containerId 容器ID
     * @return 容器日志内容
     */
    @GetMapping("/server/{serverId}/docker/container/{containerId}/logs")
    public ResponseEntity<Map<String, Object>> getContainerLogs(
            @PathVariable Long serverId,
            @PathVariable String containerId,
            @RequestParam(defaultValue = "100") int lines) {
        
        Map<String, Object> response = new HashMap<>();
        
        try {
            SshService server = Optional.ofNullable(serverService.getById(serverId))
                    .orElseThrow(() -> new RuntimeException("服务器未找到"));

            String connectionId = connectionManager.createConnection(
                    server.getHost(), server.getPort(), server.getUsername(), server.getPassword()
            );

            try {
                Session session = connectionManager.getSession(connectionId);
                if (session == null || !session.isConnected()) {
                    throw new JSchException("无法建立或获取有效的SSH会话");
                }

                // 构建 Docker logs 命令
                String command = String.format("docker logs --tail %d %s", lines, containerId);
                String logs = executeSimpleCommand(session, command);

                response.put("success", true);
                response.put("data", logs);
                response.put("lines", lines);

            } finally {
                connectionManager.closeConnection(connectionId);
            }

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("获取容器 {} 日志失败: {}", containerId, e.getMessage(), e);
            response.put("success", false);
            response.put("message", "获取容器日志失败: " + e.getMessage());
            return ResponseEntity.status(500).body(response);
        }
    }

    /**
     * 获取 Docker 容器详细信息
     * @param serverId 服务器ID
     * @param containerId 容器ID
     * @return 容器详细信息
     */
    @GetMapping("/server/{serverId}/docker/container/{containerId}/inspect")
    public ResponseEntity<Map<String, Object>> getContainerDetails(
            @PathVariable Long serverId,
            @PathVariable String containerId) {
        
        Map<String, Object> response = new HashMap<>();
        
        try {
            SshService server = Optional.ofNullable(serverService.getById(serverId))
                    .orElseThrow(() -> new RuntimeException("服务器未找到"));

            String connectionId = connectionManager.createConnection(
                    server.getHost(), server.getPort(), server.getUsername(), server.getPassword()
            );

            try {
                Session session = connectionManager.getSession(connectionId);
                if (session == null || !session.isConnected()) {
                    throw new JSchException("无法建立或获取有效的SSH会话");
                }

                // 获取容器详细信息
                String command = String.format("docker inspect %s", containerId);
                String details = executeSimpleCommand(session, command);

                response.put("success", true);
                response.put("data", details);

            } finally {
                connectionManager.closeConnection(connectionId);
            }

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("获取容器 {} 详细信息失败: {}", containerId, e.getMessage(), e);
            response.put("success", false);
            response.put("message", "获取容器详细信息失败: " + e.getMessage());
            return ResponseEntity.status(500).body(response);
        }
    }


    // --- 辅助方法 ---

    /**
     * 在给定的 SSH Session 上执行命令并解析返回的数值。
     * @param session 已连接的 JSch Session
     * @param command 要执行的命令
     * @return 解析后的 double 值，失败则返回 -1.0
     * @throws JSchException
     * @throws IOException
     */
    private double executeCommandForValue(Session session, String command) throws JSchException, IOException {
        ChannelExec channel = (ChannelExec) session.openChannel("exec");
        channel.setCommand(command);
        try (InputStream in = channel.getInputStream();
             BufferedReader reader = new BufferedReader(new InputStreamReader(in))) {

            channel.connect();

            StringBuilder outputBuffer = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                outputBuffer.append(line);
            }

            String output = outputBuffer.toString().trim();
            if (output.isEmpty()) {
                return -1.0;
            }
            return Double.parseDouble(output);

        } catch (NumberFormatException e) {
            log.warn("命令 '{}' 返回非数字输出: {}", command, e.getMessage());
            return -1.0;
        } finally {
            if (channel.isConnected()) {
                channel.disconnect();
            }
        }
    }

    /**
     * 在给定的 SSH Session 上执行简单命令并返回标准输出的第一行。
     * @param session 已连接的 JSch Session
     * @param command 要执行的命令
     * @return 命令的标准输出 (第一行)
     * @throws JSchException
     * @throws IOException
     */
    private String executeSimpleCommand(Session session, String command) throws JSchException, IOException {
        ChannelExec channel = (ChannelExec) session.openChannel("exec");
        channel.setCommand(command);
        try (InputStream in = channel.getInputStream();
             BufferedReader reader = new BufferedReader(new InputStreamReader(in))) {

            channel.connect();

            StringBuilder outputBuffer = new StringBuilder();
            String line;
            // 通常只读取第一行输出
            if ((line = reader.readLine()) != null) {
                outputBuffer.append(line);
            }
             while ((line = reader.readLine()) != null) {
                 outputBuffer.append(line).append("\n");
             }

            return outputBuffer.toString();

        } finally {
            if (channel.isConnected()) {
                channel.disconnect();
            }
        }
    }
}