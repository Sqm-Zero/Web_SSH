package com.kklsqm.webssh.controller;

import com.kklsqm.webssh.domain.SshService;
import com.kklsqm.webssh.domain.dto.DeleteRequest;
import com.kklsqm.webssh.domain.dto.RenameRequest;
import com.kklsqm.webssh.service.FileTransferService;
import com.kklsqm.webssh.service.SshServiceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

/**
 * 功能: 文件上传下载
 * 作者: 沙琪马
 * 日期: 2025/8/20 14:45
 */

@RestController
@RequestMapping("/api/servers")
@RequiredArgsConstructor
public class FileUploadController {

    private final SshServiceService sshServiceService;
    private final FileTransferService fileTransferService;

    // ========== 文件操作 ==========

    /**
     * 列出远程目录内容
     */
    @GetMapping("/{id}/files")
    public ResponseEntity<?> listFiles(
            @PathVariable Long id,
            @RequestParam(defaultValue = "/") String path) {
        SshService server = getSshService(id);
        try {
            List<FileTransferService.FileInfo> files = fileTransferService.listDirectory(server, path);
            return ResponseEntity.ok(Map.of("success", true, "data", files));
        } catch (Exception e) {
            return error("目录读取失败: " + e.getMessage());
        }
    }

    /**
     * 上传文件
     */
    @PostMapping("/{id}/upload")
    public ResponseEntity<?> uploadFile(
            @PathVariable Long id,
            @RequestParam("path") String remotePath,
            @RequestParam("files") MultipartFile[] uploadFiles) {
        SshService server = getSshService(id);
        try {
            fileTransferService.uploadFiles(server, uploadFiles, remotePath);
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "message", "上传成功"
            ));
        } catch (Exception e) {
            return error("上传失败: " + e.getMessage());
        }
    }

    /**
     * 下载文件
     */
    @GetMapping("/{id}/download")
    public ResponseEntity<byte[]> downloadFile(
            @PathVariable Long id,
            @RequestParam String path) {
        SshService server = getSshService(id);
        try {
            byte[] data = fileTransferService.downloadFile(server, path);
            String filename = path.substring(path.lastIndexOf("/") + 1);
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                    .body(data);
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                    .body(("下载失败: " + e.getMessage()).getBytes());
        }
    }

    /**
     * 创建目录
     */
    @PostMapping("/{id}/mkdir")
    public ResponseEntity<?> createDirectory(
            @PathVariable Long id,
            @RequestParam String path) {
        SshService server = getSshService(id);
        try {
            fileTransferService.createRemoteDirectory(server, path);
            return ResponseEntity.ok(Map.of("success", true, "message", "目录创建成功"));
        } catch (Exception e) {
            return error("创建目录失败: " + e.getMessage());
        }
    }

    /**
     * 删除文件/目录
     */
    @DeleteMapping("/{id}/file")
    public ResponseEntity<?> deleteFile(
            @PathVariable Long id,
            @RequestBody DeleteRequest deleteRequest) {
        SshService server = getSshService(id);
        try {
            fileTransferService.deleteRemoteFile(server, deleteRequest.getPath(), deleteRequest.isDirectory());
            return ResponseEntity.ok(Map.of("success", true, "message", "删除成功"));
        } catch (Exception e) {
            return error("删除失败: " + e.getMessage());
        }
    }

    /**
     * 重命名文件
     */
    @PutMapping("/{id}/rename")
    public ResponseEntity<?> renameFile(
            @PathVariable Long id,
            @RequestBody RenameRequest renameRequest) {
        SshService server = getSshService(id);
        try {
            fileTransferService.renameRemoteFile(server, renameRequest.getOldPath(), renameRequest.getNewPath());
            return ResponseEntity.ok(Map.of("success", true, "message", "重命名成功"));
        } catch (Exception e) {
            return error("重命名失败: " + e.getMessage());
        }
    }

    // ========== 辅助方法 ==========

    private SshService getSshService(Long id) {
        return sshServiceService.getById(id);
    }

    private ResponseEntity<Map<String, Object>> error(String message) {
        return ResponseEntity.badRequest().body(Map.of("success", false, "message", message));
    }
}