/*
 Navicat Premium Data Transfer

 Source Server         : 本地mysql
 Source Server Type    : MySQL
 Source Server Version : 80028 (8.0.28)
 Source Host           : localhost:3306
 Source Schema         : web_ssh

 Target Server Type    : MySQL
 Target Server Version : 80028 (8.0.28)
 File Encoding         : 65001

 Date: 27/08/2025 17:21:36
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for servers
-- ----------------------------
DROP TABLE IF EXISTS `servers`;
CREATE TABLE `servers`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '服务器名称',
  `host` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '服务器地址',
  `port` int NULL DEFAULT 22 COMMENT 'SSH端口',
  `username` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '用户名',
  `password` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '密码（建议加密存储）',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 6 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of servers
-- ----------------------------
INSERT INTO `servers` VALUES (1, '本地测试服务器', 'localhost', 22, 'root', 'password', '2025-08-19 20:06:08', '2025-08-19 20:06:08');
INSERT INTO `servers` VALUES (2, '开发服务器', '192.168.1.100', 22, 'dev', 'devpass', '2025-08-19 20:06:08', '2025-08-19 20:06:08');
INSERT INTO `servers` VALUES (3, '测试服务器', '192.168.88.139', 22, 'root', '123456', '2025-08-19 20:06:08', '2025-08-27 11:01:28');
INSERT INTO `servers` VALUES (4, '生产服务器', '192.168.1.200', 22, 'prod', 'prodpass', '2025-08-19 20:06:08', '2025-08-19 20:06:08');
INSERT INTO `servers` VALUES (5, '测试服务器', '192.168.88.137', 22, 'root', '123124', '2025-08-26 19:20:14', '2025-08-26 19:20:27');

SET FOREIGN_KEY_CHECKS = 1;
