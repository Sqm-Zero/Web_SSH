package com.kklsqm.webssh.controller;

import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import com.kklsqm.webssh.domain.SshService;
import com.kklsqm.webssh.service.SshServiceService;
import jakarta.annotation.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 功能:  服务器管理
 * 作者: 沙琪马
 * 日期: 2025/8/19 19:58
 */
@RestController
@RequestMapping("/api/servers")
public class ServerController {

    @Resource
    private SshServiceService serverService;

    /**
     * 获取服务器列表
     */
    @GetMapping
    public ResponseEntity<List<SshService>> getServers() {
        List<SshService> servers = serverService.list();
        return ResponseEntity.ok(servers);
    }

    /**
     * 添加服务器
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> addServer(@RequestBody SshService server) {
        try {
            serverService.saveOrUpdate(server);
            return ResponseEntity.ok(Map.of("success", true, "id", server.getId()));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    /**
     * 删除服务器
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> deleteServer(@PathVariable Long id) {
        try {
            serverService.removeById(id);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    /**
     * 测试服务器连接
     */
    @PostMapping("/test")
    public ResponseEntity<Map<String, Object>> testConnection(@RequestBody SshService server) {
        try {
            // 简单的连接测试
            JSch jsch = new JSch();
            Session session = jsch.getSession(server.getUsername(), server.getHost(), server.getPort());
            session.setPassword(server.getPassword());
            session.setConfig("StrictHostKeyChecking", "no");
            session.connect(5000); // 5秒超时
            session.disconnect();

            return ResponseEntity.ok(Map.of("success", true, "message", "连接测试成功"));
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("success", false, "message", "连接测试失败: " + e.getMessage()));
        }
    }
}